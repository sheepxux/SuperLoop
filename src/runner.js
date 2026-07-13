import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readData, writeJson, writeText } from "./fs-utils.js";
import { acquireLease, releaseLease, renewLease } from "./lease.js";
import { nextRun, readBoundState, readLoopState, recordRun, resolveLoop, withLoopStateLock } from "./loop-state.js";
import { validateData } from "./validation.js";

export function runTick({
  root = ".loop-engineering/loops",
  loopName = null,
  now = null,
  timeoutMs = null,
  allowCommand = false,
  forceManual = false
} = {}) {
  const targets = discoverLoopDirs(root, loopName);
  const outcomes = [];
  const hasInjectedNow = now !== null && now !== undefined;

  for (const target of targets) {
    // A long scheduler tick can visit many loops. Unless a caller supplies a
    // clock explicitly (as tests and deterministic replays do), take a fresh
    // timestamp for each loop instead of reusing the tick's start time.
    const loopNow = now ?? new Date();
    let loop;
    try {
      loop = resolveLoop(target);
      const state = readLoopState(loop);
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
      const configuredTimeoutMs = Math.min(
        loop.spec.schedule.timeoutMinutes,
        loop.spec.safety.budgets.maxRuntimeMinutes
      ) * 60_000;
      if (
        timeoutMs !== null
        && (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > configuredTimeoutMs)
      ) {
        throw new Error(`timeoutMs must be positive and no greater than the configured ${configuredTimeoutMs}ms limit.`);
      }

      const cadence = cadenceStatus(loop.spec, state, loopNow, forceManual);
      if (!cadence.due) {
        outcomes.push(result(loop, "skipped", cadence.reason));
        continue;
      }

      const plan = nextRun(loop, loopNow);
      if (!plan.ok) {
        outcomes.push(result(loop, "skipped", "preflight-blocked", { reasons: plan.reasons }));
        continue;
      }

      const runId = makeRunId(loopNow, loop.spec.metadata.name);
      const leaseClock = hasInjectedNow && loop.spec.runner.executor === "dry-run" ? loopNow : new Date();
      const lease = acquireLease(loop.loopDir, runId, loop.spec.schedule.timeoutMinutes, { now: leaseClock });
      if (!lease.acquired) {
        outcomes.push(result(loop, "skipped", "lease-held", { lease: lease.lease }));
        continue;
      }

      try {
        loop = resolveLoop(target);
        if (
          loop.resolvedGeneration !== lease.lease.generation
          || loop.resolvedContractSha256 !== lease.lease.contractSha256
        ) {
          throw new Error("Loop generation or contract changed while acquiring the Runner lease.");
        }
        const confirmedState = readLoopState(loop);
        const confirmedCadence = cadenceStatus(loop.spec, confirmedState, loopNow, forceManual);
        if (!confirmedCadence.due) {
          outcomes.push(result(loop, "skipped", confirmedCadence.reason, { recheckedAfterLease: true }));
          continue;
        }
        const confirmedPlan = nextRun(loop, loopNow);
        if (!confirmedPlan.ok) {
          outcomes.push(result(loop, "skipped", "preflight-changed", { reasons: confirmedPlan.reasons }));
          continue;
        }
        try {
          outcomes.push(executeLoop(loop, confirmedPlan, runId, lease, {
            now: loopNow,
            timeoutMs: timeoutMs ?? configuredTimeoutMs,
            deterministicNow: hasInjectedNow
          }));
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
        releaseLease(lease.leasePath, lease.lease.token || runId);
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
      const state = readLoopState(loop);
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
  return withLoopStateLock(loop, () => {
    const state = readBoundState(loop);
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
  });
}

export function listRuns(target) {
  const loop = resolveLoop(target);
  return withLoopStateLock(loop, () => {
    // The enclosing lock recovers a durable transaction first. Keep the
    // state read and directory scan in the same critical section so a new
    // commit cannot expose a half-observed artifact set between them.
    readBoundState(loop);
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
  });
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
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) throw new Error("Runner clock must be a valid Date.");
  if (state.lastRunAt) {
    const lastRunAt = parseRunnerUtcTimestamp(state.lastRunAt, "state.lastRunAt");
    if (lastRunAt > nowMs + 5 * 60_000) {
      throw new Error("state.lastRunAt cannot be more than five minutes in the future.");
    }
  }
  const today = new Date(nowMs).toISOString().slice(0, 10);
  if (state.budgets?.date && state.budgets.date > today) {
    throw new Error("state.budgets.date cannot be later than the Runner's UTC accounting day.");
  }
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
  const last = parseRunnerUtcTimestamp(state.lastRunAt, "state.lastRunAt");
  return nowMs - last >= interval
    ? { due: true, reason: "interval-elapsed" }
    : { due: false, reason: "not-due" };
}

function parseRunnerUtcTimestamp(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    throw new Error(`${field} must be an ISO-8601 UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`${field} is not a valid UTC timestamp.`);
  }
  return parsed;
}

function parseInterval(cadence) {
  const match = /^every\s+(\d+)\s*([mhd])$/i.exec(String(cadence).trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()];
  return value * unit;
}

function executeLoop(loop, plan, runId, lease, { now, timeoutMs, deterministicNow }) {
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

  const startedAt = loop.spec.runner.executor === "command" ? new Date().toISOString() : now.toISOString();
  const startedMs = Date.now();
  let runLog;
  let executorStatus = "passed";
  let commandDraftAccepted = false;
  let rejectedDraftUsage = null;

  if (loop.spec.runner.executor === "dry-run") {
    appendEvent(eventPath, "executor-start", { executor: "dry-run" }, new Date());
    executorStatus = "dry-run";
    runLog = baseRunLog(loop, runId, startedAt, "dry-run");
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
        LOOP_STARTED_AT: startedAt,
        LOOP_STRATEGY: loop.strategyPath ? path.resolve(loop.strategyPath) : "",
        LOOP_STRATEGY_VERSION: plan.evolution?.enabled
          ? String(plan.evolution.currentStrategyVersion)
          : "",
        LOOP_STRATEGY_SHA256: plan.evolution?.enabled
          ? String(plan.evolution.currentStrategySha256)
          : ""
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
      try {
        runLog = readData(draftPath);
        rejectedDraftUsage = extractReportedUsage(runLog);
        runLog.startedAt = startedAt;
        if (runLog.runId !== runId) {
          throw new Error(`Command run log id "${runLog.runId}" does not match runner id "${runId}".`);
        }
        if (runLog.status === "running") {
          throw new Error("Command run log must contain a terminal status, not running.");
        }
        if (runLog.status === "dry-run") {
          throw new Error("A command executor cannot classify real execution as dry-run.");
        }
        bindCommandDraftStrategy(loop, plan, runLog);
        commandDraftAccepted = true;
      } catch (error) {
        executorStatus = "failed";
        runLog = failedRunnerLog(loop, runId, startedAt, "invalid-run-log", error?.message || String(error));
        appendEvent(eventPath, "executor-fallback-log", {
          reason: "invalid-run-log",
          message: error?.message || String(error)
        }, new Date());
      }
    } else {
      executorStatus = "failed";
      if (fs.existsSync(draftPath)) {
        try {
          rejectedDraftUsage = extractReportedUsage(readData(draftPath));
        } catch {
          // Preserve the raw draft for diagnosis; unreadable usage cannot be
          // safely inferred beyond measured runtime.
        }
      }
      const type = exitCode === 0 ? "missing-run-log" : "command-failed";
      const message = exitCode === 0
        ? "Command exited successfully but did not write the required run-log draft."
        : `Command executor exited with code ${exitCode}.`;
      runLog = failedRunnerLog(loop, runId, startedAt, type, message);
      appendEvent(eventPath, "executor-fallback-log", {
        reason: exitCode === 0 ? "missing-run-log" : "command-failed"
      }, new Date());
    }
  }

  // Explicit clocks make dry-run scheduler tests/replays fully deterministic,
  // including the lease validity check performed during recording. Real and
  // command executions continue to use the wall clock for completion data.
  const recordedAt = deterministicNow && loop.spec.runner.executor === "dry-run"
    ? new Date(now)
    : new Date();
  const finishedAt = recordedAt.toISOString();
  if (loop.spec.runner.executor === "command") {
    runLog.startedAt = startedAt;
    runLog.finishedAt = finishedAt;
  } else {
    runLog.finishedAt = runLog.finishedAt || finishedAt;
  }
  const measuredRuntime = Math.max(0, (Date.now() - startedMs) / 60_000);
  runLog.budget = observedBudget(runLog, measuredRuntime);
  let observedOverrun = false;
  if (loop.spec.runner.executor === "command" && budgetWasExceeded(loop, runLog.budget, runLog.results?.length || 0)) {
    const observed = runLog.budget;
    executorStatus = "failed";
    commandDraftAccepted = false;
    observedOverrun = true;
    runLog = budgetExceededRunnerLog(
      loop,
      runId,
      startedAt,
      observed,
      "The command consumed or reported work beyond the configured per-run budget."
    );
    runLog.finishedAt = finishedAt;
    appendEvent(eventPath, "executor-budget-exceeded", { budget: observed }, recordedAt);
  } else if (loop.spec.runner.executor === "command" && !commandDraftAccepted && rejectedDraftUsage) {
    const observed = observedBudget({ budget: rejectedDraftUsage }, measuredRuntime);
    if (budgetWasExceeded(loop, observed, rejectedDraftUsage.itemsAttempted)) {
      observedOverrun = true;
      runLog = budgetExceededRunnerLog(
        loop,
        runId,
        startedAt,
        observed,
        "The rejected command draft reported work beyond the configured per-run budget."
      );
      runLog.finishedAt = finishedAt;
      appendEvent(eventPath, "executor-budget-exceeded", { budget: observed }, recordedAt);
    } else {
      runLog.budget.runtimeMinutes = observed.runtimeMinutes;
      runLog.budget.estimatedUsd = observed.estimatedUsd;
    }
  }
  let recorded;
  if (!renewLease(lease.leasePath, lease.lease.token, loop.spec.schedule.timeoutMinutes, { now: recordedAt })) {
    throw new Error(`Runner lease ownership was lost before run ${runId} could be recorded.`);
  }
  try {
    recorded = recordRun(loop, runLog, {
      now: recordedAt,
      runFile,
      allowDryRun: loop.spec.runner.executor === "dry-run",
      allowObservedOverrun: observedOverrun,
      leaseToken: lease.lease.token
    });
  } catch (error) {
    if (loop.spec.runner.executor !== "command" || !commandDraftAccepted) throw error;
    executorStatus = "failed";
    appendEvent(eventPath, "executor-draft-rejected", { message: error?.message || String(error) }, new Date());
    const observed = observedBudget(runLog, Math.max(0, (Date.now() - startedMs) / 60_000));
    const exceeded = budgetWasExceeded(loop, observed, runLog.results?.length || 0);
    runLog = failedRunnerLog(loop, runId, startedAt, "invalid-run-log", error?.message || String(error));
    runLog.finishedAt = new Date().toISOString();
    runLog.budget = exceeded
      ? observed
      : { ...observed, itemsAttempted: 0 };
    if (exceeded) {
      runLog.status = "budget-exceeded";
      runLog.failure.type = "budget-exceeded";
    }
    recorded = recordRun(loop, runLog, {
      now: new Date(),
      runFile,
      leaseToken: lease.lease.token,
      allowObservedOverrun: exceeded
    });
  }
  appendEvent(eventPath, "run-recorded", { status: runLog.status, statePath: recorded.statePath }, new Date());
  writeText(path.join(runDir, "summary.md"), summary(loop, runLog, executorStatus));
  appendEvent(eventPath, "runner-end", { status: runLog.status }, new Date());

  const outcome = runLog.status === "dry-run"
    ? "dry-run"
    : ["passed", "no-work"].includes(runLog.status)
      ? "ran"
      : "failed";
  return result(loop, outcome, "executed", {
    runId,
    runDir,
    runFile,
    executor: loop.spec.runner.executor
  });
}

function bindCommandDraftStrategy(loop, plan, runLog) {
  if (!loop.spec.evolution?.enabled || !Array.isArray(runLog.results) || runLog.results.length === 0) return;
  const strategy = {
    version: plan.evolution?.currentStrategyVersion,
    sha256: plan.evolution?.currentStrategySha256
  };
  if (!Number.isInteger(strategy.version) || !/^[a-f0-9]{64}$/.test(strategy.sha256 || "")) {
    throw new Error("Frozen Runner plan is missing the active strategy version or digest.");
  }
  if (
    runLog.strategy
    && (runLog.strategy.version !== strategy.version || runLog.strategy.sha256 !== strategy.sha256)
  ) {
    throw new Error("Command run log strategy binding conflicts with the frozen Runner plan.");
  }
  runLog.strategy = strategy;
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
  return log;
}

function failedRunnerLog(loop, runId, startedAt, type, summaryText) {
  const log = baseRunLog(loop, runId, startedAt, "failed");
  log.failure = { type, summary: String(summaryText).slice(0, 2_000) };
  return log;
}

function budgetExceededRunnerLog(loop, runId, startedAt, budget, summaryText) {
  const log = baseRunLog(loop, runId, startedAt, "budget-exceeded");
  log.failure = { type: "budget-exceeded", summary: String(summaryText).slice(0, 2_000) };
  log.budget = budget;
  return log;
}

function extractReportedUsage(value) {
  const budget = value && typeof value === "object" ? value.budget : null;
  if (!value || typeof value !== "object") return null;
  const reported = budget && typeof budget === "object" ? budget : {};
  const inferredItems = Array.isArray(value.results) ? value.results.length : 0;
  return {
    itemsAttempted: Math.max(nonnegativeInteger(reported.itemsAttempted, inferredItems), inferredItems),
    estimatedUsd: nonnegativeNumber(reported.estimatedUsd, 0)
  };
}

function observedBudget(value, runtimeMinutes) {
  const source = extractReportedUsage(value) || { itemsAttempted: 0, estimatedUsd: 0 };
  return {
    runtimeMinutes: nonnegativeNumber(runtimeMinutes, 0),
    itemsAttempted: source.itemsAttempted,
    estimatedUsd: source.estimatedUsd
  };
}

function budgetWasExceeded(loop, budget, resultCount) {
  const configured = loop.spec.safety.budgets;
  const itemsAllowed = Math.min(loop.spec.discovery.maxItemsPerRun, configured.maxItemsPerRun);
  return budget.runtimeMinutes > configured.maxRuntimeMinutes
    || budget.itemsAttempted > itemsAllowed
    || resultCount > itemsAllowed
    || (
      typeof configured.maxEstimatedUsdPerRun === "number"
      && budget.estimatedUsd > configured.maxEstimatedUsdPerRun
    );
}

function nonnegativeNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nonnegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
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
