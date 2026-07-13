import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { loopAdminLockPath, readData, withFileLock, writeJson } from "./fs-utils.js";

// Lease mutations are short synchronous file operations. Wait at most two
// seconds for a live owner, and reclaim only dead claims older than 30 seconds.
const OPERATION_LOCK_TIMEOUT_MS = 2_000;
const OPERATION_LOCK_STALE_MS = 30_000;
const OPERATION_LOCK_POLL_MS = 10;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

export function acquireLease(loopDir, runId, timeoutMinutes, { now = new Date() } = {}) {
  const lockDir = path.join(loopDir, "locks");
  const leasePath = path.join(lockDir, "active-run.json");
  fs.mkdirSync(lockDir, { recursive: true });

  return withFileLock(loopAdminLockPath(loopDir), () => {
    return withLeaseOperationLock(leasePath, () => {
      const state = readData(path.join(loopDir, "state.json"));
      if (
        typeof state.generation !== "string"
        || !/^[a-f0-9]{64}$/.test(state.contractSha256 || "")
      ) {
        throw new Error("Loop state is missing v1.0.2 generation/contract bindings; migrate it before acquiring a lease.");
      }
      const active = readLease(leasePath);
      if (active && !isExpired(active, now)) {
        return { acquired: false, leasePath, lease: active, recovered: null };
      }

      const lease = {
        token: crypto.randomUUID(),
        runId,
        generation: state.generation,
        contractSha256: state.contractSha256,
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: now.toISOString(),
        heartbeatAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + timeoutMinutes * 60_000 + 60_000).toISOString()
      };
      writeJson(leasePath, lease);
      return { acquired: true, leasePath, lease, recovered: active };
    });
  });
}

export function releaseLease(leasePath, ownerToken) {
  return withLeaseOperationLock(leasePath, () => {
    const active = readLease(leasePath);
    if (!active || leaseOwner(active) !== ownerToken) {
      return false;
    }
    try {
      fs.unlinkSync(leasePath);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  });
}

export function renewLease(leasePath, ownerToken, timeoutMinutes, { now = new Date() } = {}) {
  return withLeaseOperationLock(leasePath, () => {
    const active = readLease(leasePath);
    if (!active || leaseOwner(active) !== ownerToken) return false;
    writeJson(leasePath, {
      ...active,
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeoutMinutes * 60_000 + 60_000).toISOString()
    });
    return true;
  });
}

export function writeLease(loopDir, lease) {
  const leasePath = path.join(loopDir, "locks", "active-run.json");
  withLeaseOperationLock(leasePath, () => writeJson(leasePath, lease));
  return leasePath;
}

function readLease(leasePath) {
  let lease;
  try {
    lease = readData(leasePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw invalidLeaseError(leasePath, error.message);
  }

  if (!lease || typeof lease !== "object" || Array.isArray(lease)) {
    throw invalidLeaseError(leasePath, "expected an object");
  }
  if (typeof lease.runId !== "string" || lease.runId.trim().length === 0) {
    throw invalidLeaseError(leasePath, "runId must be a non-empty string");
  }
  if (typeof lease.token !== "string" || lease.token.length === 0) {
    throw invalidLeaseError(leasePath, "token must be a non-empty string");
  }
  if (typeof lease.generation !== "string" || lease.generation.length === 0) {
    throw invalidLeaseError(leasePath, "generation must be a non-empty string");
  }
  if (!/^[a-f0-9]{64}$/.test(lease.contractSha256 || "")) {
    throw invalidLeaseError(leasePath, "contractSha256 must be a SHA-256 digest");
  }
  if (!Number.isInteger(lease.pid) || lease.pid < 1 || typeof lease.hostname !== "string" || lease.hostname.length === 0) {
    throw invalidLeaseError(leasePath, "pid and hostname must identify the owner process");
  }
  const startedAt = strictUtcTimestamp(lease.startedAt);
  const heartbeatAt = strictUtcTimestamp(lease.heartbeatAt);
  const expiresAt = strictUtcTimestamp(lease.expiresAt);
  if (![startedAt, heartbeatAt, expiresAt].every(Number.isFinite)) {
    throw invalidLeaseError(leasePath, "startedAt, heartbeatAt, and expiresAt must be valid timestamps");
  }
  if (heartbeatAt < startedAt || expiresAt <= heartbeatAt) {
    throw invalidLeaseError(leasePath, "lease timestamps are out of order");
  }
  return lease;
}

function strictUtcTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    return Number.NaN;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    return Number.NaN;
  }
  return parsed;
}

function invalidLeaseError(leasePath, detail) {
  return new Error(`Invalid active lease ${leasePath}; refusing automatic recovery: ${detail}`);
}

function isExpired(lease, now) {
  return Date.parse(lease.expiresAt) <= now.getTime();
}

function leaseOwner(lease) {
  return lease.token;
}

function withLeaseOperationLock(leasePath, operation) {
  const claimsDir = path.join(path.dirname(leasePath), ".lease-operations");
  fs.mkdirSync(claimsDir, { recursive: true });
  const claimPath = path.join(
    claimsDir,
    `${Date.now()}-${process.pid}-${crypto.randomUUID()}.lock`
  );
  fs.mkdirSync(claimPath);

  const deadline = Date.now() + OPERATION_LOCK_TIMEOUT_MS;
  try {
    // Bakery-style tickets give every contender a stable ordering. A claim
    // without a ticket is still choosing, so ready contenders wait for it.
    const initialClaims = listOperationClaims(claimsDir, claimPath);
    const ticket = initialClaims.reduce((maximum, claim) => {
      return claim.ticket === null ? maximum : Math.max(maximum, claim.ticket);
    }, 0) + 1;
    writeJson(path.join(claimPath, "ticket.json"), { ticket });

    while (true) {
      const claims = listOperationClaims(claimsDir, claimPath);
      const choosing = claims.some((claim) => claim.ticket === null);
      const ready = claims
        .filter((claim) => claim.ticket !== null)
        .sort((left, right) => left.ticket - right.ticket || left.name.localeCompare(right.name));
      if (!choosing && ready[0]?.path === claimPath) {
        return operation();
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${OPERATION_LOCK_TIMEOUT_MS}ms waiting for lease operation lock: ${leasePath}`
        );
      }
      Atomics.wait(sleepBuffer, 0, 0, OPERATION_LOCK_POLL_MS);
    }
  } finally {
    removeClaim(claimPath);
  }
}

function listOperationClaims(claimsDir, ownClaimPath) {
  const now = Date.now();
  const claims = [];
  for (const entry of fs.readdirSync(claimsDir, { withFileTypes: true })) {
    if (!entry.name.endsWith(".lock")) continue;
    const claimPath = path.join(claimsDir, entry.name);
    if (!entry.isDirectory()) {
      throw new Error(`Invalid lease operation lock entry: ${claimPath}`);
    }
    let stat;
    try {
      stat = fs.statSync(claimPath, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const createdNs = stat.birthtimeNs > 0n ? stat.birthtimeNs : stat.ctimeNs;
    const ageMs = now - Number(createdNs / 1_000_000n);
    if (
      claimPath !== ownClaimPath &&
      ageMs >= OPERATION_LOCK_STALE_MS &&
      !claimProcessIsAlive(entry.name)
    ) {
      removeClaim(claimPath);
      continue;
    }
    const ticket = readOperationTicket(claimPath);
    claims.push({ path: claimPath, name: entry.name, ticket });
  }
  return claims;
}

function claimProcessIsAlive(name) {
  const match = /^\d+-(\d+)-/.exec(name);
  if (!match) return false;
  try {
    process.kill(Number(match[1]), 0);
    return true;
  } catch (error) {
    if (error.code === "EPERM") return true;
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function readOperationTicket(claimPath) {
  const ticketPath = path.join(claimPath, "ticket.json");
  let data;
  try {
    data = readData(ticketPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Invalid lease operation ticket ${ticketPath}: ${error.message}`);
  }
  if (!data || !Number.isSafeInteger(data.ticket) || data.ticket < 1) {
    throw new Error(`Invalid lease operation ticket: ${ticketPath}`);
  }
  return data.ticket;
}

function removeClaim(claimPath) {
  try {
    fs.rmSync(claimPath, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
