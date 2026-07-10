import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readData, writeJson } from "./fs-utils.js";

export function acquireLease(loopDir, runId, timeoutMinutes, { now = new Date() } = {}) {
  const lockDir = path.join(loopDir, "locks");
  const leasePath = path.join(lockDir, "active-run.json");
  fs.mkdirSync(lockDir, { recursive: true });

  let recovered = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const lease = {
      runId,
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeoutMinutes * 60_000).toISOString()
    };

    try {
      const handle = fs.openSync(leasePath, "wx");
      fs.writeFileSync(handle, `${JSON.stringify(lease, null, 2)}\n`);
      fs.closeSync(handle);
      return { acquired: true, leasePath, lease, recovered };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }

      const active = safeReadLease(leasePath);
      if (!active || isExpired(active, now)) {
        recovered = active;
        try {
          fs.unlinkSync(leasePath);
        } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") {
            throw unlinkError;
          }
        }
        continue;
      }
      return { acquired: false, leasePath, lease: active, recovered: null };
    }
  }

  return { acquired: false, leasePath, lease: safeReadLease(leasePath), recovered };
}

export function releaseLease(leasePath, runId) {
  const active = safeReadLease(leasePath);
  if (!active) {
    return false;
  }
  if (active.runId !== runId) {
    return false;
  }
  try {
    fs.unlinkSync(leasePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function writeLease(loopDir, lease) {
  const leasePath = path.join(loopDir, "locks", "active-run.json");
  writeJson(leasePath, lease);
  return leasePath;
}

function safeReadLease(leasePath) {
  try {
    return readData(leasePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function isExpired(lease, now) {
  const expiresAt = new Date(lease.expiresAt);
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime();
}
