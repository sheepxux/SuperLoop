import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readData, writeJson, writeText } from "./fs-utils.js";
import { acquireLease, releaseLease } from "./lease.js";
import { nextRun, readState, recordRun, resolveLoop } from "./loop-state.js";
import { validateData } from "./validation.js";

export function runTick({
  root = ".loop-engineering/loops",
  loopName = null,
  now = new Date(),
  timeoutMs = null,
  allowCommand = false,
  forceManual = false
} = {}) {
  const targets = discoverLoopDirs(root, loopName);
  const outcomes = [];

  for (const target of targets) {
    let loop;
    try {
      loop = resolveLoop(target);
      const state = readState(loop.statePath, loop.spec.metadata.name);
      if (state.paused) {
        outcomes.push(result(loop, "skipped", "paused", { pauseReason: state.pauseReason ?? null }));
        continue;
      }
      if (!loop.spec.runner) {
        outcomes.push(result(loop, "skipped", "runner-not-configured"));
        continue;
      }
      if (loop.spec.runner.executor === "command" && !allowCommand) {
        outcomes.push(result(loop, "skipped", "command-executor-disabled"));
        continue;
      }

      const cadence = cadenceStatus(loop.spec, state, now, forceManual);
      if (!cadence.due) {
        outcomes.push(result(loop, "skipped", cadence.reason));
        continue;
      }

      const plan = nextRun(loop, now);
      if (!plan.ok) {
        outcomes.push(result(loop, "skipped", "preflight-blocked", { reasons: plan.reasons }));
        continue;
      }

      const runId = makeRunId(now, loop.spec.metadata.name);
      const lease = acquireLease(loop.loopDir, runId, loop.spec.schedule.timeoutMinutes, { now });
      if (!lease.acquired) {
        outcomes.push(result(loop, "skipped", "lease-held", { lease: lease.lease }));
        continue;
      }

      try {
        try {
          outcomes.push(executeLoop(loop, plan, runId, lease, { now, timeoutMs }));
        } catch (error) {
          const runDir = path.join(loop.runLogDir, runId);
          const eventPath = path.join(runDir, "events.ndjson");
          appendEvent(eventPath, "runner-error", { message: error?.message || String(error) }, new Date());
          writeText(
            path.join(runDir, "summary.md"),
            `# ${loop.spec.metadata.name} run ${runId}\n\n- Status: error\n- Error: ${error?.message || String(error)}\n`
          );
          outcomes.push(result(loop, "error", error?.message || String(error), { runId, runDir }));
        }
      } finally {
        releaseLease(lease.leasePath, runId);
      }
    } catch (error) {
      outcomes.push({
        loop: loop?.spec?.metadata?.name || path.basename(target),
        status: "error",
        reason: error?.message || String(error)
      });
    }
  }

  return outcomes;
}

export function statusLoops({ root = ".loop-engineering/loops", now = new Date() } = {}) {
  return discoverLoopDirs(root).map((target) => {
    try {
      const loop = resolveLoop(target);
      const state = readState(loop.statePath, loop.spec.metadata.name);
      const plan = nextRun(loop, now);
      const cadence = cadenceStatus(loop.spec, state, now, false);
      return {
        loop: loop.spec.metadata.name,
        paused: state.paused === true,
        lastRunAt: state.lastRunAt,
        due: cadence.due,
        cadenceReason: cadence.reason,
        preflightOk: plan.ok,
        runsRemainingToday: plan.budget.runsRemainingToday,
        retryItems: plan.retryQueue.length,
        needsHuman: plan.needsHuman.length,
        runner: loop.spec.runner?.executor || null,
        evolution: plan.evolution
      };
    } catch (error) {
      return { loop: path.basename(target), error: error?.message || String(error) };
    }
  });
}

export function setPaused(target, paused, reason = null) {
  const loop = resolveLoop(target);
  const state = readState(loop.statePath, loop.spec.metadata.name);
  const nextState = {
    ...state,
    paused,
    pauseReason: paused ? reason || "Paused by operator" : null
  };
  const validation = validateData("state", nextState, "updated state");
  if (!validation.ok) {
    throw new Error(`Refusing to write invalid state: ${validation.errors.join("; ")}`);
  }
  writeJson(loop.statePath, nextState);
  return { loop: loop.spec.metadata.name, statePath: loop.statePath, paused, pauseReason: nextState.pauseReason };
}

export function listRuns(target) {
  const loop = resolveLoop(target);
  if (!fs.existsSync(loop.runLogDir)) {
    return [];
  }
  const entries = fs.readdirSync(loop.runLogDir, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const candidate = entry.isDirectory()
      ? path.join(loop.runLogDir, entry.name, "run-log.json")
      : entry.name.endsWith(".json")
        ? path.join(loop.runLogDir, entry.name)
        : null;
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      const run = readData(candidate);
      runs.push({ runId: run.runId, status: run.status, finishedAt: run.finishedAt, file: candidate });
    } catch {
      runs.push({ runId: entry.name, status: "invalid", finishedAt: null, file: candidate });
    }
  }
  return runs.sort((a, b) => String(b.finishedAt || b.runId).localeCompare(String(a.finishedAt || a.runId)));
}

function discoverLoopDirs(root, loopName = null) {
  if (!fs.existsSync(root)) {
    return [];
  }
  if (loopName) {
    const target = path.join(root, loopName);
    return fs.existsSync(path.join(target, "loop.yaml")) ? [target] : [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, "loop.yaml")))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function cadenceStatus(spec, state, now, explicit) {
  if (explicit) {
    return { due: true, reason: "explicit-loop" };
  }
  if (spec.schedule.runtime === "manual" || spec.schedule.cadence === "manual") {
    return { due: false, reason: "manual-loop" };
  }
  if (["github-actions", "codex-automation", "cloud-scheduler"].includes(spec.schedule.runtime)) {
    return { due: false, reason: `external-scheduler:${spec.schedule.runtime}` };
  }

  const interval = parseInterval(spec.schedule.cadence);
  if (interval === null) {
    return { due: false, reason: `unsupported-cadence:${spec.schedule.cadence}` };
  }
  if (!state.lastRunAt) {
    return { due: true, reason: "never-run" };
  }
  const last = new Date(state.lastRunAt);
  if (Number.isNaN(last.getTime())) {
    return { due: true, reason: "invalid-last-run" };
  }
  return now.getTime() - last.getTime() >= interval
    ? { due: true, reason: "interval-elapsed" }
    : { due: false, reason: "not-due" };
}

function parseInterval(cadence) {
  const match = /^every\s+(\d+)\s*([mhd])$/i.exec(String(cadence).trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()];
  return value * unit;
}

function executeLoop(loop, plan, runId, lease, { now, timeoutMs }) {
  const runDir = path.join(loop.runLogDir, runId);
  const eventPath = path.join(runDir, "events.ndjson");
  const draftPath = path.join(runDir, "run-log.draft.json");
  const runFile = path.join(runDir, "run-log.json");
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, "plan.json"), plan);
  appendEvent(eventPath, "runner-start", { runId, executor: loop.spec.runner.executor }, now);
  if (lease.recovered) {
    appendEvent(eventPath, "lease-recovered", { priorRunId: lease.recovered.runId || null }, now);
  }
  appendEvent(eventPath, "lease-acquired", { lease: lease.lease }, now);

  const startedAt = now.toISOString();
  const startedMs = Date.now();
  let runLog;
  let executorStatus = "passed";

  if (loop.spec.runner.executor === "dry-run") {
    appendEvent(eventPath, "executor-start", { executor: "dry-run" }, new Date());
    runLog = baseRunLog(loop, runId, startedAt, "passed");
    appendEvent(eventPath, "executor-end", { executor: "dry-run", exitCode: 0 }, new Date());
  } else {
    appendEvent(eventPath, "executor-start", { executor: "command" }, new Date());
    const cwd = path.resolve(loop.spec.runner.workingDirectory);
    const execution = spawnSync(loop.spec.runner.command, {
      cwd,
      env: {
        ...process.env,
        LOOP_DIR: path.resolve(loop.loopDir),
        LOOP_SPEC: path.resolve(loop.specPath),
        LOOP_RUN_DIR: path.resolve(runDir),
        LOOP_RUN_LOG: path.resolve(draftPath),
        LOOP_PLAN: path.resolve(runDir, "plan.json"),
        LOOP_RUN_ID: runId,
        LOOP_STRATEGY: loop.strategyPath ? path.resolve(loop.strategyPath) : ""
      },
      encoding: "utf8",
      shell: true,
      timeout: timeoutMs ?? loop.spec.schedule.timeoutMinutes * 60_000
    });
    writeText(path.join(runDir, "stdout.log"), execution.stdout || "");
    writeText(path.join(runDir, "stderr.log"), execution.stderr || execution.error?.message || "");
    const exitCode = execution.status ?? (execution.error ? 1 : 0);
    appendEvent(eventPath, "executor-end", {
      executor: "command",
      exitCode,
      signal: execution.signal || null,
      timedOut: execution.error?.code === "ETIMEDOUT"
    }, new Date());

    if (exitCode === 0 && fs.existsSync(draftPath)) {
      runLog = readData(draftPath);
      if (runLog.runId !== runId) {
        throw new Error(`Command run log id "${runLog.runId}" does not match runner id "${runId}".`);
      }
      if (runLog.status === "running") {
        throw new Error("Command run log must contain a terminal status, not running.");
      }
    } else {
      executorStatus = "failed";
      runLog = baseRunLog(loop, runId, startedAt, "failed");
      appendEvent(eventPath, "executor-fallback-log", {
        reason: exitCode === 0 ? "missing-run-log" : "command-failed"
      }, new Date());
    }
  }

  const finishedAt = new Date().toISOString();
  runLog.finishedAt = runLog.finishedAt || finishedAt;
  runLog.budget = {
    ...(runLog.budget || {}),
    runtimeMinutes: Math.max(0, (Date.now() - startedMs) / 60_000)
  };
  if (loop.spec.evolution?.enabled && typeof runLog.metrics?.[loop.spec.evolution.metric.name] !== "number") {
    runLog.metrics = { ...(runLog.metrics || {}), [loop.spec.evolution.metric.name]: 0 };
  }

  const recorded = recordRun(loop, runLog, { force: true, now: new Date(), runFile });
  appendEvent(eventPath, "run-recorded", { status: runLog.status, statePath: recorded.statePath }, new Date());
  writeText(path.join(runDir, "summary.md"), summary(loop, runLog, executorStatus));
  appendEvent(eventPath, "runner-end", { status: runLog.status }, new Date());

  return result(loop, runLog.status === "passed" ? "ran" : "failed", "executed", {
    runId,
    runDir,
    runFile,
    executor: loop.spec.runner.executor
  });
}

function baseRunLog(loop, runId, startedAt, status) {
  const log = {
    apiVersion: "loop-engineering/v1",
    loop: loop.spec.metadata.name,
    runId,
    startedAt,
    finishedAt: null,
    status,
    discovered: [],
    results: [],
    budget: { runtimeMinutes: 0, itemsAttempted: 0, estimatedUsd: 0 }
  };
  if (loop.spec.evolution?.enabled) {
    log.metrics = { [loop.spec.evolution.metric.name]: 0 };
  }
  return log;
}

function appendEvent(file, type, data, at) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ type, at: at.toISOString(), ...data })}\n`);
}

function summary(loop, runLog, executorStatus) {
  return `# ${loop.spec.metadata.name} run ${runLog.runId}\n\n- Status: ${runLog.status}\n- Executor: ${loop.spec.runner.executor}\n- Executor result: ${executorStatus}\n- Items attempted: ${runLog.results.length}\n- Finished: ${runLog.finishedAt}\n`;
}

function makeRunId(now, name) {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${name}`;
}

function result(loop, status, reason, details = {}) {
  return { loop: loop.spec.metadata.name, status, reason, ...details };
}
