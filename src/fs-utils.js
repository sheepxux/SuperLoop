import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

export function readData(filePath) {
  const raw = readText(filePath);
  if (filePath.endsWith(".json")) {
    return JSON.parse(raw);
  }
  return YAML.parse(raw);
}

export function writeYaml(filePath, value) {
  writeTextAtomic(filePath, YAML.stringify(value, { lineWidth: 100 }));
}

export function writeJson(filePath, value) {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  let handle;
  try {
    handle = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(handle, value);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(temporary, filePath);
    fsyncDirectory(directory);
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export function fsyncDirectory(directory) {
  let handle;
  try {
    handle = fs.openSync(directory, "r");
    fs.fsyncSync(handle);
  } catch (error) {
    // Directory fsync is unavailable on some supported filesystems/platforms.
    // The file itself is still fsynced above; degrade only for known support
    // errors rather than making every atomic write unusable.
    if (!["EINVAL", "EISDIR", "EPERM", "ENOTSUP"].includes(error.code)) throw error;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

export function loopAdminLockPath(loopDir) {
  const root = path.dirname(path.resolve(loopDir));
  return path.join(root, ".loop-engineering-admin-locks", `${path.basename(path.resolve(loopDir))}.lock`);
}

export function withFileLock(lockPath, callback, { timeoutMs = 10_000, staleMs = 300_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const token = crypto.randomUUID();
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const prepared = `${lockPath}.claim.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  let acquired = false;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.mkdirSync(prepared);
  writeJson(path.join(prepared, "owner.json"), {
    token,
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString()
  });
  try {
    while (true) {
      try {
        fs.renameSync(prepared, lockPath);
        acquired = true;
        break;
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;

        let stale = false;
        try {
          stale = Date.now() - fs.statSync(lockPath).mtimeMs > staleMs;
        } catch (statError) {
          if (statError.code !== "ENOENT") throw statError;
          continue;
        }
        if (stale && lockOwnerIsDead(lockPath)) {
          const reclaimed = withLockRecoveryClaim(lockPath, deadline, () => {
            let stillStale;
            try {
              stillStale = Date.now() - fs.statSync(lockPath).mtimeMs > staleMs;
            } catch (statError) {
              if (statError.code === "ENOENT") return true;
              throw statError;
            }
            if (!stillStale || !lockOwnerIsDead(lockPath)) return false;
            const quarantine = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
            try {
              fs.renameSync(lockPath, quarantine);
              fs.rmSync(quarantine, { recursive: true, force: true });
              return true;
            } catch (recoveryError) {
              if (["ENOENT", "EEXIST", "ENOTEMPTY"].includes(recoveryError.code)) return false;
              throw recoveryError;
            }
          });
          if (reclaimed) continue;
        }

        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for state lock: ${lockPath}`);
        }
        Atomics.wait(sleeper, 0, 0, 10);
      }
    }
  } catch (error) {
    if (!acquired) fs.rmSync(prepared, { recursive: true, force: true });
    throw error;
  }

  try {
    return callback();
  } finally {
    try {
      const owner = readData(path.join(lockPath, "owner.json"));
      if (owner.token === token) {
        const quarantine = `${lockPath}.released.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
        fs.renameSync(lockPath, quarantine);
        fs.rmSync(quarantine, { recursive: true, force: true });
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!acquired) fs.rmSync(prepared, { recursive: true, force: true });
  }
}

function withLockRecoveryClaim(lockPath, deadline, callback) {
  const claimsDir = `${lockPath}.recovery-claims`;
  fs.mkdirSync(claimsDir, { recursive: true });
  const name = `${Date.now()}-${process.pid}-${crypto.randomUUID()}.lock`;
  const claimPath = path.join(claimsDir, name);
  fs.mkdirSync(claimPath);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  try {
    const initial = listLockRecoveryClaims(claimsDir, claimPath);
    const ticket = initial.reduce((maximum, claim) => Math.max(maximum, claim.ticket || 0), 0) + 1;
    writeJson(path.join(claimPath, "ticket.json"), { ticket });
    while (true) {
      const claims = listLockRecoveryClaims(claimsDir, claimPath);
      const choosing = claims.some((claim) => claim.ticket === null);
      const ready = claims
        .filter((claim) => claim.ticket !== null)
        .sort((left, right) => left.ticket - right.ticket || left.name.localeCompare(right.name));
      if (!choosing && ready[0]?.path === claimPath) return callback();
      if (Date.now() >= deadline) throw new Error(`Timed out waiting to recover state lock: ${lockPath}`);
      Atomics.wait(sleeper, 0, 0, 10);
    }
  } finally {
    fs.rmSync(claimPath, { recursive: true, force: true });
  }
}

function listLockRecoveryClaims(claimsDir, ownClaimPath) {
  const claims = [];
  const now = Date.now();
  for (const entry of fs.readdirSync(claimsDir, { withFileTypes: true })) {
    if (!entry.name.endsWith(".lock")) continue;
    const claimPath = path.join(claimsDir, entry.name);
    if (!entry.isDirectory()) throw new Error(`Invalid state-lock recovery claim: ${claimPath}`);
    const match = /^\d+-(\d+)-/.exec(entry.name);
    let alive = false;
    if (match) {
      try {
        process.kill(Number(match[1]), 0);
        alive = true;
      } catch (error) {
        if (error.code === "EPERM") alive = true;
        else if (error.code !== "ESRCH") throw error;
      }
    }
    let stat;
    try {
      stat = fs.statSync(claimPath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (claimPath !== ownClaimPath && now - stat.ctimeMs > 30_000 && !alive) {
      fs.rmSync(claimPath, { recursive: true, force: true });
      continue;
    }
    let ticket = null;
    try {
      const data = readData(path.join(claimPath, "ticket.json"));
      if (!Number.isSafeInteger(data.ticket) || data.ticket < 1) {
        throw new Error(`Invalid state-lock recovery ticket: ${claimPath}`);
      }
      ticket = data.ticket;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    claims.push({ path: claimPath, name: entry.name, ticket });
  }
  return claims;
}

function lockOwnerIsDead(lockPath) {
  let owner;
  try {
    owner = readData(path.join(lockPath, "owner.json"));
  } catch (error) {
    // A process can die after mkdir and before owner.json is durable. Once the
    // lock directory itself is stale there is no live owner to protect.
    if (error.code === "ENOENT") return true;
    return false;
  }
  if (owner.hostname !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (error.code === "EPERM") return false;
    if (error.code === "ESRCH") return true;
    throw error;
  }
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function sha256Json(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

export function assertCanWriteDir(dir, { force = false } = {}) {
  if (fs.existsSync(dir) && !force && fs.readdirSync(dir).length > 0) {
    throw new Error(`Refusing to overwrite non-empty directory: ${dir}. Pass --force to replace files.`);
  }
  fs.mkdirSync(dir, { recursive: true });
}

export function schemaPath(name) {
  const file = {
    loop: "loop.schema.json",
    state: "state.schema.json",
    evaluator: "evaluator.schema.json",
    "run-log": "run-log.schema.json",
    strategy: "strategy.schema.json",
    experiment: "experiment.schema.json",
    approval: "approval.schema.json",
    decision: "decision.schema.json"
  }[name];
  if (!file) {
    throw new Error(`Unknown schema "${name}". Expected loop, state, evaluator, run-log, strategy, experiment, approval, or decision.`);
  }
  return path.join(repoRoot, "protocol", file);
}
