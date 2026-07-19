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
    const parsed = JSON.parse(raw);
    // Native JSON.parse accepts duplicate keys and silently keeps the last one.
    // Parse a second time with YAML's JSON schema solely to enforce I-JSON/JCS
    // uniqueness at every object level before any digest or decision is trusted.
    YAML.parse(raw, { schema: "json", uniqueKeys: true });
    return parsed;
  }
  return YAML.parse(raw, { uniqueKeys: true });
}

export function writeYaml(filePath, value) {
  writeTextAtomic(filePath, YAML.stringify(value, { lineWidth: 100 }));
}

export function writeJson(filePath, value) {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeYamlExclusive(filePath, value) {
  writeTextExclusive(filePath, YAML.stringify(value, { lineWidth: 100 }));
}

export function writeJsonExclusive(filePath, value) {
  writeTextExclusive(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

export function writeTextExclusive(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  let handle;
  try {
    handle = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(handle, value);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.linkSync(temporary, filePath);
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
  return path.join(root, ".superloop-admin-locks", `${path.basename(path.resolve(loopDir))}.lock`);
}

export function withFileLock(lockPath, callback, { timeoutMs = 10_000, staleMs = 300_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const token = crypto.randomUUID();
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const prepared = `${lockPath}.claim.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  let acquired = false;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.mkdirSync(prepared);
  writeLockOwner(prepared, token);
  try {
    while (true) {
      const acquiredThisAttempt = withLockAcquisitionGate(lockPath, deadline, () => {
        if (publishPreparedLock(prepared, lockPath, token)) return true;

        let stale = false;
        try {
          stale = Date.now() - fs.statSync(lockPath).mtimeMs > staleMs;
        } catch (statError) {
          if (statError.code !== "ENOENT") throw statError;
          return publishPreparedLock(prepared, lockPath, token);
        }
        if (!stale || !lockOwnerIsDead(lockPath)) return false;

        const quarantine = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
        try {
          fs.renameSync(lockPath, quarantine);
          fs.rmSync(quarantine, { recursive: true, force: true });
        } catch (recoveryError) {
          if (!["ENOENT", "EEXIST", "ENOTEMPTY"].includes(recoveryError.code)) throw recoveryError;
        }
        return publishPreparedLock(prepared, lockPath, token);
      });
      if (acquiredThisAttempt) {
        acquired = true;
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for state lock: ${lockPath}`);
      }
      Atomics.wait(sleeper, 0, 0, 10);
    }
  } catch (error) {
    if (!acquired) fs.rmSync(prepared, { recursive: true, force: true });
    throw error;
  }

  const release = () => {
    let owner;
    try {
      owner = readData(path.join(lockPath, "owner.json"));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`State lock disappeared before its owner released it: ${lockPath}`);
      }
      throw error;
    }
    if (owner.token !== token) {
      throw new Error(`State lock ownership changed before release: ${lockPath}`);
    }
    const quarantine = `${lockPath}.released.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
    try {
      fs.renameSync(lockPath, quarantine);
      fs.rmSync(quarantine, { recursive: true, force: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(`State lock disappeared during owner release: ${lockPath}`);
      }
      throw error;
    }
  };

  let result;
  try {
    result = callback();
  } catch (error) {
    release();
    throw error;
  }
  try {
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(release);
    }
  } catch (error) {
    // Reading a user-supplied thenable may itself throw. Treat that exactly
    // like a synchronous callback failure so the lock cannot be orphaned by a
    // hostile or malformed `then` getter.
    release();
    throw error;
  }
  release();
  return result;
}

function writeLockOwner(directory, token) {
  writeJson(path.join(directory, "owner.json"), {
    token,
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString()
  });
}

function publishPreparedLock(prepared, lockPath, token) {
  // Refresh both the diagnostic acquisition time and directory mtime at the
  // actual publication attempt; a contender may have waited a long time after
  // creating its private prepared directory.
  // Check the pathname explicitly because POSIX rename may replace an existing
  // empty directory; an ownerless/corrupt canonical lock must fail closed.
  try {
    fs.lstatSync(lockPath);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  writeLockOwner(prepared, token);
  try {
    fs.renameSync(prepared, lockPath);
    return true;
  } catch (error) {
    if (["EEXIST", "ENOTEMPTY"].includes(error.code)) return false;
    throw error;
  }
}

function withLockAcquisitionGate(lockPath, deadline, callback) {
  // Publishing a prepared owner and reclaiming a stale owner must share one
  // atomic doorway. Without it, a delayed reclaimer can inspect owner A,
  // owner B can acquire the same pathname, and the reclaimer can then rename
  // B's live directory (an ABA race). This short-lived gate is deliberately
  // never auto-reclaimed: a crash here fails closed until an operator verifies
  // no loop process is running and removes the gate manually.
  const gatePath = `${lockPath}.acquire`;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let acquired = false;
  fs.mkdirSync(path.dirname(gatePath), { recursive: true });
  try {
    while (true) {
      try {
        fs.mkdirSync(gatePath);
        acquired = true;
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for state-lock acquisition gate: ${gatePath}. `
          + "A crashed acquisition must be inspected and cleared manually while no loop process is running."
        );
      }
      Atomics.wait(sleeper, 0, 0, 10);
    }
    writeJson(path.join(gatePath, "owner.json"), {
      token: crypto.randomUUID(),
      pid: process.pid,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString()
    });
    return callback();
  } finally {
    if (acquired) {
      const released = `${gatePath}.released.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
      try {
        fs.renameSync(gatePath, released);
        fs.rmSync(released, { recursive: true, force: true });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
}

function lockOwnerIsDead(lockPath) {
  let owner;
  try {
    owner = readData(path.join(lockPath, "owner.json"));
  } catch (error) {
    // Canonical locks are published only after owner.json is durable in a
    // private prepared directory. A missing or malformed owner therefore
    // indicates corruption or an unknown implementation, not a safe reclaim.
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
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError("Canonical JSON cannot encode sparse arrays.");
      }
      items.push(canonicalJson(value[index]));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON accepts only plain JSON objects.");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError("Canonical JSON cannot encode symbol-keyed properties.");
    }
    return `{${Object.keys(value).sort().map((key) => {
      assertValidUnicode(key);
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    }).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot encode non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string") assertValidUnicode(value);
    return JSON.stringify(value);
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value}.`);
}

function assertValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Canonical JSON cannot encode lone Unicode surrogates.");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("Canonical JSON cannot encode lone Unicode surrogates.");
    }
  }
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
    "goal-evaluation": "goal-evaluation.schema.json",
    "run-log": "run-log.schema.json",
    strategy: "strategy.schema.json",
    experiment: "experiment.schema.json",
    approval: "approval.schema.json",
    decision: "decision.schema.json",
    proposal: "proposal.schema.json",
    "proposal-decision": "proposal-decision.schema.json"
  }[name];
  if (!file) {
    throw new Error(
      `Unknown schema "${name}". Expected loop, state, evaluator, goal-evaluation, run-log, strategy, experiment, approval, decision, proposal, or proposal-decision.`
    );
  }
  return path.join(repoRoot, "protocol", file);
}
