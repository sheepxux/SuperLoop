import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fsyncDirectory, loopAdminLockPath, readData, sha256Json, withFileLock, writeJson } from "./fs-utils.js";
import {
  assessExperiment,
  evolutionPlan,
  initialEvolutionState,
  updateEvolutionForRun
} from "./evolution.js";
import { validateData, validateLoopSpec } from "./validation.js";

const VERDICT_TO_STATUS = new Map([
  ["pass", "passed"],
  ["fail", "failed"],
  ["blocked", "blocked"],
  ["needs-human", "needs-human"]
]);

export function resolveLoop(target) {
  if (!fs.existsSync(target)) {
    throw new Error(`Loop target not found: ${target}`);
  }

  let specPath;
  let loopDir;
  if (fs.statSync(target).isDirectory()) {
    loopDir = target;
    specPath = path.join(target, "loop.yaml");
    if (!fs.existsSync(specPath)) {
      throw new Error(`No loop.yaml found in directory: ${target}`);
    }
  } else {
    specPath = target;
    loopDir = path.dirname(target);
  }

  const spec = readData(specPath);
  const specResult = validateLoopSpec(spec, specPath);
  if (!specResult.ok) {
    const details = specResult.errors.join("; ");
    throw new Error(`Invalid loop spec ${specPath}: ${details}`);
  }

  // Prefer files co-located with loop.yaml (the `loopctl init` layout);
  // fall back to the paths declared in persistence for hand-rolled layouts.
  const statePath = pickPath(path.join(loopDir, "state.json"), spec.persistence.statePath);
  const runLogDir = pickPath(path.join(loopDir, "runs"), spec.persistence.runLogDir);
  const inboxPath = pickPath(path.join(loopDir, "inbox.md"), spec.persistence.inboxPath);
  const strategyPath = spec.evolution?.enabled
    ? pickPath(path.join(loopDir, "strategy.json"), spec.persistence.strategyPath)
    : null;
  const experimentDir = spec.evolution?.enabled
    ? pickPath(path.join(loopDir, "experiments"), spec.persistence.experimentDir)
    : null;
  const strategyArchiveDir = spec.evolution?.enabled ? path.join(loopDir, "strategies") : null;
  let resolvedGeneration = null;
  if (fs.existsSync(statePath)) {
    try {
      resolvedGeneration = readData(statePath).generation ?? null;
    } catch {
      // readState will provide the fail-closed diagnostic at the public read boundary.
    }
  }

  return {
    spec,
    specPath,
    loopDir,
    statePath,
    runLogDir,
    inboxPath,
    strategyPath,
    experimentDir,
    strategyArchiveDir,
    resolvedGeneration,
    resolvedContractSha256: sha256Json(spec)
  };
}

function pickPath(colocated, declared) {
  return fs.existsSync(colocated) ? colocated : declared;
}

export function readState(statePath, loopName) {
  if (!fs.existsSync(statePath)) {
    throw new Error(`Loop state is missing: ${statePath}. Restore it or run loopctl init explicitly; refusing to reset durable state.`);
  }
  const state = readData(statePath);
  const result = validateData("state", state, statePath);
  if (!result.ok) {
    throw new Error(`Invalid state file ${statePath}: ${result.errors.join("; ")}`);
  }
  if (state.loop !== loopName) {
    throw new Error(`State loop "${state.loop}" does not match spec loop "${loopName}".`);
  }
  const recordedIds = (state.recordedRuns || []).map((entry) => entry.runId);
  if (new Set(recordedIds).size !== recordedIds.length) {
    throw new Error(`State file ${statePath} contains duplicate recorded run IDs.`);
  }
  const itemIds = state.items.map((entry) => entry.id);
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error(`State file ${statePath} contains duplicate item IDs.`);
  }
  const experimentIds = (state.evolution?.history || []).map((entry) => entry.experimentId);
  if (new Set(experimentIds).size !== experimentIds.length) {
    throw new Error(`State file ${statePath} contains duplicate evolution experiment IDs.`);
  }
  const archiveVersions = (state.evolution?.strategyArchives || []).map((entry) => entry.version);
  if (new Set(archiveVersions).size !== archiveVersions.length) {
    throw new Error(`State file ${statePath} contains duplicate strategy archive versions.`);
  }
  validateStateTemporalSyntax(state, statePath);
  return state;
}

function validateStateTemporalSyntax(state, statePath) {
  const label = `State file ${statePath}`;
  if (state.lastRunAt !== null) parseStateUtcTimestamp(state.lastRunAt, "lastRunAt", label);
  if (state.budgets.date !== null && state.budgets.date !== undefined) {
    assertUtcCalendarDay(state.budgets.date, "budgets.date", label);
  }
  const recorded = state.recordedRuns || [];
  let priorFinishedAt = null;
  for (const entry of recorded) {
    const finishedAt = parseStateUtcTimestamp(entry.finishedAt, `recordedRuns[${entry.runId}].finishedAt`, label);
    if (priorFinishedAt !== null && finishedAt < priorFinishedAt) {
      throw new Error(`${label} recordedRuns timestamps must be monotonic.`);
    }
    priorFinishedAt = finishedAt;
  }
  const nonDryRuns = recorded.filter((entry) => entry.status !== "dry-run");
  if (nonDryRuns.length > 0) {
    const ledgerLastRunAt = nonDryRuns.at(-1).finishedAt;
    if (state.lastRunAt !== ledgerLastRunAt) {
      throw new Error(`${label} lastRunAt must match the latest non-dry-run ledger entry.`);
    }
  }
  const pending = state.evolution?.pendingExperiment;
  if (pending) parseStateUtcTimestamp(pending.stagedAt, "evolution.pendingExperiment.stagedAt", label);
  for (const entry of state.evolution?.history || []) {
    if (entry.approval) {
      parseStateUtcTimestamp(
        entry.approval.approvedAt,
        `evolution.history[${entry.experimentId}].approval.approvedAt`,
        label
      );
    }
    if (entry.decision) {
      parseStateUtcTimestamp(
        entry.decision.decidedAt,
        `evolution.history[${entry.experimentId}].decision.decidedAt`,
        label
      );
    }
  }
  for (const entry of state.evolution?.rollbackHistory || []) {
    parseStateUtcTimestamp(entry.at, `evolution.rollbackHistory[v${entry.newVersion}].at`, label);
  }
}

function parseStateUtcTimestamp(value, field, label = "State") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    throw new Error(`${label} ${field} must be an ISO-8601 UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`${label} ${field} is not a valid UTC timestamp.`);
  }
  return parsed;
}

function assertUtcCalendarDay(value, field, label = "State") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} ${field} must be a UTC calendar day (YYYY-MM-DD).`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} ${field} is not a real UTC calendar day.`);
  }
}

function assertStateTemporalBounds(state, now) {
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) throw new Error("Runtime clock must be a valid Date.");
  if (state.lastRunAt && parseStateUtcTimestamp(state.lastRunAt, "lastRunAt") > nowMs + 5 * 60_000) {
    throw new Error("State lastRunAt cannot be more than five minutes in the future.");
  }
  if (state.budgets.date && state.budgets.date > utcDay(now)) {
    throw new Error("State budgets.date cannot be later than the current UTC accounting day.");
  }
}

export function readBoundState(loop) {
  const state = readState(loop.statePath, loop.spec.metadata.name);
  assertStateBinding(loop, state);
  return state;
}

export function withLoopStateLock(loop, callback) {
  assertManagedTransactionTarget(loop, path.join(loop.loopDir, "locks", "state-update.lock"));
  return withFileLock(loopAdminLockPath(loop.loopDir), () => {
    return withFileLock(path.join(loop.loopDir, "locks", "state-update.lock"), () => {
      recoverLoopTransaction(loop);
      return callback();
    });
  });
}

export function nextRun(loop, now = new Date()) {
  return withLoopStateLock(loop, () => nextRunLocked(loop, now));
}

function nextRunLocked(loop, now) {
  const { spec, statePath } = loop;
  const state = readBoundState(loop);
  assertStateTemporalBounds(state, now);
  assertStrategyStateConsistent(loop, state);
  const budgets = spec.safety.budgets;
  const retries = spec.safety.retries;

  const rolledOver = isNewBudgetDay(state, now);
  const runsToday = rolledOver ? 0 : state.budgets.runsToday;
  const runtimeMinutesToday = rolledOver ? 0 : state.budgets.runtimeMinutesToday;
  const estimatedUsdToday = rolledOver ? 0 : (state.budgets.estimatedUsdToday ?? 0);

  const reasons = [];
  if (state.paused) {
    reasons.push(`Loop is paused${state.pauseReason ? `: ${state.pauseReason}` : "."}`);
  }
  if (runsToday >= budgets.maxDailyRuns) {
    reasons.push(`Daily run budget exhausted (${runsToday}/${budgets.maxDailyRuns} runs today).`);
  }

  const retryQueue = [];
  const exhausted = [];
  const needsHuman = [];
  for (const item of state.items) {
    if (item.status === "needs-human") {
      needsHuman.push({ id: item.id, summary: item.summary });
      continue;
    }
    if (item.status !== "open" && item.status !== "failed") {
      continue;
    }
    if (item.status === "failed" && item.retries >= retries.maxRetriesPerItem) {
      exhausted.push({ id: item.id, retries: item.retries, action: retries.onRepeatedFailure });
    } else {
      retryQueue.push({ id: item.id, status: item.status, retries: item.retries });
    }
  }
  if (exhausted.some((item) => item.action === "stop-run")) {
    reasons.push("Retry policy requires the run to stop because at least one item exhausted its retry budget.");
  }

  return {
    loop: spec.metadata.name,
    ok: reasons.length === 0,
    reasons,
    itemsAllowed: Math.min(spec.discovery.maxItemsPerRun, budgets.maxItemsPerRun),
    budget: {
      runsToday,
      maxDailyRuns: budgets.maxDailyRuns,
      runsRemainingToday: Math.max(0, budgets.maxDailyRuns - runsToday),
      runtimeMinutesToday,
      maxRuntimeMinutesPerRun: budgets.maxRuntimeMinutes,
      estimatedUsdToday,
      maxEstimatedUsdPerRun: budgets.maxEstimatedUsdPerRun ?? null,
      dayRolledOver: rolledOver
    },
    retryQueue,
    exhausted,
    needsHuman,
    humanOnly: spec.safety.humanGates.humanOnly,
    stopConditions: spec.goal.stopConditions,
    evolution: evolutionPlan(spec, state, loop)
  };
}

export function readLoopState(loop) {
  return withLoopStateLock(loop, () => readBoundState(loop));
}

export function migrateLoopState(loop, { now = new Date(), allowRemoteExpiredLease = false } = {}) {
  return withLoopStateLock(loop, () => {
    const state = readState(loop.statePath, loop.spec.metadata.name);
    const contractSha256 = sha256Json(loop.spec);
    const alreadyMigrated = typeof state.generation === "string"
      && state.contractSha256 === contractSha256
      && (
        !loop.spec.evolution?.enabled
        || (
          typeof state.evolution?.currentStrategySha256 === "string"
          && Array.isArray(state.evolution?.strategyArchives)
          && Number.isInteger(state.evolution?.runsSinceExperiment)
          && Number.isInteger(state.evolution?.consecutiveFailuresSinceExperiment)
        )
      );
    if (alreadyMigrated) {
      assertStateBinding(loop, state);
      assertStrategyStateConsistent(loop, state);
      return {
        statePath: loop.statePath,
        generation: state.generation,
        contractSha256,
        strategyArchives: state.evolution?.strategyArchives?.length || 0,
        retiredLease: null,
        invalidatedPendingExperiment: null,
        alreadyMigrated: true
      };
    }
    const retiredLease = retireExpiredMigrationLease(loop, now, { allowRemoteExpiredLease });
    if (state.contractSha256 && state.contractSha256 !== contractSha256) {
      throw new Error("Existing state contract digest differs from loop.yaml; refusing migration.");
    }
    const nextState = {
      ...state,
      generation: state.generation || crypto.randomUUID(),
      contractSha256
    };
    if (loop.spec.evolution?.enabled) {
      const active = readData(loop.strategyPath);
      const activeValidation = validateData("strategy", active, loop.strategyPath);
      if (!activeValidation.ok || active.loop !== loop.spec.metadata.name) {
        throw new Error(`Cannot anchor invalid active strategy: ${activeValidation.errors.join("; ")}`);
      }
      if (state.evolution?.currentStrategyVersion !== active.version) {
        throw new Error("Cannot migrate: active strategy version differs from durable evolution state.");
      }
      const archiveFiles = fs.readdirSync(loop.strategyArchiveDir)
        .filter((name) => /^v\d+\.json$/.test(name))
        .sort((left, right) => Number(left.slice(1, -5)) - Number(right.slice(1, -5)));
      const anchors = [];
      if (archiveFiles.length !== active.version) {
        throw new Error(`Cannot migrate: strategy archives must contain exactly v1 through active v${active.version}.`);
      }
      for (let index = 0; index < archiveFiles.length; index += 1) {
        const name = archiveFiles[index];
        const file = path.join(loop.strategyArchiveDir, name);
        const archived = readData(file);
        const validation = validateData("strategy", archived, file);
        const version = Number(name.slice(1, -5));
        const expectedVersion = index + 1;
        const expectedParent = expectedVersion === 1 ? null : expectedVersion - 1;
        if (
          !validation.ok
          || archived.loop !== loop.spec.metadata.name
          || archived.version !== version
          || version !== expectedVersion
          || archived.parentVersion !== expectedParent
        ) {
          throw new Error(`Cannot anchor invalid strategy archive: ${file}`);
        }
        anchors.push({ version, sha256: sha256Json(archived) });
      }
      const activeAnchor = anchors.find((entry) => entry.version === active.version);
      if (!activeAnchor || activeAnchor.sha256 !== sha256Json(active)) {
        throw new Error("Active strategy must exactly match its archived version before migration.");
      }
      let history = [...(state.evolution?.history || [])];
      let pendingExperiment = state.evolution?.pendingExperiment ?? null;
      let invalidatedPendingExperiment = null;
      if (pendingExperiment) {
        const matching = history.filter((entry) => (
          entry.experimentId === pendingExperiment.experimentId
          && entry.sha256 === pendingExperiment.sha256
          && entry.outcome === "pending-review"
        ));
        if (matching.length !== 1) {
          throw new Error("Cannot migrate: pending experiment is not bound to exactly one pending-review history entry.");
        }
        invalidatedPendingExperiment = pendingExperiment.experimentId;
        history = history.map((entry) => entry === matching[0]
          ? {
              ...entry,
              outcome: "invalidated",
              reason: "Invalidated by v1.0.2 migration because prior evidence lacks per-strategy digest attribution."
            }
          : entry);
        pendingExperiment = null;
      }
      nextState.evolution = {
        ...state.evolution,
        currentStrategyVersion: active.version,
        currentStrategySha256: sha256Json(active),
        strategyArchives: anchors.slice(-1000),
        runsSinceExperiment: invalidatedPendingExperiment
          ? loop.spec.evolution.trigger.afterRuns
          : state.evolution?.runsSinceExperiment ?? state.evolution?.runsSincePromotion ?? 0,
        consecutiveFailuresSinceExperiment: state.evolution?.consecutiveFailuresSinceExperiment
          ?? state.evolution?.consecutiveFailures
          ?? 0,
        pendingExperiment,
        history: history.slice(-1000)
      };
    }
    const validation = validateData("state", nextState, "migrated state");
    if (!validation.ok) throw new Error(`Refusing invalid state migration: ${validation.errors.join("; ")}`);
    writeJson(loop.statePath, nextState);
    return {
      statePath: loop.statePath,
      generation: nextState.generation,
      contractSha256,
      strategyArchives: nextState.evolution?.strategyArchives?.length || 0,
      retiredLease,
      invalidatedPendingExperiment: state.evolution?.pendingExperiment?.experimentId ?? null,
      alreadyMigrated: false
    };
  });
}

function retireExpiredMigrationLease(loop, now, { allowRemoteExpiredLease = false } = {}) {
  const leasePath = path.join(loop.loopDir, "locks", "active-run.json");
  if (!fs.existsSync(leasePath)) return null;
  let lease;
  try {
    lease = readData(leasePath);
  } catch (error) {
    throw new Error(`Active lease is unreadable; inspect it manually before migration: ${error.message}`);
  }
  if (!lease || typeof lease !== "object" || Array.isArray(lease)) {
    throw new Error("Active lease is invalid; inspect it manually before migration.");
  }
  let expiresAt;
  try {
    expiresAt = parseStateUtcTimestamp(lease.expiresAt, "lease.expiresAt");
  } catch {
    throw new Error("Active lease has no trustworthy UTC expiry; inspect it manually before migration.");
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Migration clock must be a valid Date.");
  }
  if (expiresAt > now.getTime()) {
    throw new Error(`Active lease for run ${lease.runId || "unknown"} has not expired; stop the Runner before migration.`);
  }
  if (lease.hostname === os.hostname() && Number.isInteger(lease.pid) && lease.pid > 0) {
    try {
      process.kill(lease.pid, 0);
      throw new Error(`Expired lease owner process ${lease.pid} is still alive; stop it before migration.`);
    } catch (error) {
      if (error.code === "EPERM") {
        throw new Error(`Expired lease owner process ${lease.pid} may still be alive; stop it before migration.`);
      }
      if (error.code !== "ESRCH") throw error;
    }
  } else if (!allowRemoteExpiredLease) {
    throw new Error(
      `Expired lease owner on host ${lease.hostname || "unknown"} cannot be proven dead; `
      + "after operator verification, re-run migrate with --retire-expired-lease."
    );
  }
  const digest = sha256Json(lease);
  const retiredPath = path.join(loop.loopDir, "locks", `retired-active-run-${digest}.json`);
  if (fs.existsSync(retiredPath)) {
    if (sha256Json(readData(retiredPath)) !== digest) {
      throw new Error(`Retired lease audit artifact conflicts with the expired lease: ${retiredPath}`);
    }
    fs.unlinkSync(leasePath);
  } else {
    fs.renameSync(leasePath, retiredPath);
  }
  fsyncDirectory(path.dirname(leasePath));
  return path.relative(loop.loopDir, retiredPath).replaceAll("\\", "/");
}

export function recordRun(loop, runLog, options = {}) {
  return withLoopStateLock(loop, () => recordRunLocked(loop, runLog, options));
}

function recordRunLocked(
  loop,
  runLog,
  {
    now = new Date(),
    runFile: requestedRunFile = null,
    allowDryRun = false,
    allowObservedOverrun = false,
    leaseToken = null
  } = {}
) {
  const { spec, statePath, runLogDir } = loop;

  const runResult = validateData("run-log", runLog, "run log");
  if (!runResult.ok) {
    throw new Error(`Run log does not match protocol/run-log.schema.json: ${runResult.errors.join("; ")}`);
  }
  if (runLog.loop !== spec.metadata.name) {
    throw new Error(`Run log loop "${runLog.loop}" does not match spec loop "${spec.metadata.name}".`);
  }
  if (runLog.status === "running" || runLog.finishedAt === null) {
    throw new Error("loopctl record accepts terminal run logs only.");
  }
  const state = readBoundState(loop);
  assertStrategyStateConsistent(loop, state);
  let runFile = requestedRunFile || path.join(runLogDir, `${artifactStem(runLog.runId)}.json`);
  const digest = sha256Json(runLog);
  const priorRecord = (state.recordedRuns || []).find((entry) => entry.runId === runLog.runId);
  if (priorRecord) {
    runFile = path.resolve(loop.loopDir, priorRecord.artifact);
    assertManagedTransactionTarget(loop, runFile);
  }
  if (fs.existsSync(runFile)) {
    const existing = readData(runFile);
    if (sha256Json(existing) !== digest) {
      throw new Error(`Run log is immutable and already exists with different content: ${runFile}`);
    }
    if (!priorRecord) {
      throw new Error(`Run artifact exists without a state ledger entry; refusing ambiguous replay: ${runFile}`);
    }
    if (priorRecord.sha256 !== digest) {
      throw new Error(`State ledger digest does not match immutable run artifact: ${runLog.runId}`);
    }
    if (
      priorRecord.status !== runLog.status
      || priorRecord.finishedAt !== runLog.finishedAt
      || path.resolve(loop.loopDir, priorRecord.artifact) !== path.resolve(runFile)
    ) {
      throw new Error(`State ledger metadata does not match immutable run artifact: ${runLog.runId}`);
    }
    validateRunReplayEvidence(loop, runLog);
    const attention = state.items.filter((item) => item.status === "blocked" || item.status === "needs-human");
    return {
      runFile,
      statePath,
      state,
      attention,
      observationOnly: runLog.status === "dry-run",
      replayed: true
    };
  }
  if (priorRecord) {
    throw new Error(`State ledger references a missing immutable run artifact: ${runFile}`);
  }

  const requiresTrustedLease = runLog.status === "dry-run" || allowObservedOverrun;
  const runnerBound = leaseToken !== null;
  const activeLease = assertActiveLeaseAccess(loop, leaseToken, {
    required: requiresTrustedLease || runnerBound,
    runId: runnerBound ? runLog.runId : null,
    now,
    state
  });
  if (
    runLog.status === "dry-run"
    && (!allowDryRun || spec.runner?.executor !== "dry-run" || !activeLease)
  ) {
    throw new Error("dry-run records are reserved for the configured dry-run Runner with its active lease.");
  }
  if (allowObservedOverrun && (runLog.status !== "budget-exceeded" || !activeLease)) {
    throw new Error("Observed budget overruns require a budget-exceeded Runner record bound to its active lease.");
  }

  validateRunSemantics(loop, runLog, state, now, { allowObservedOverrun });

  if (spec.evolution?.enabled && runLog.results.length > 0) {
    const metric = spec.evolution.metric.name;
    if (typeof runLog.metrics?.[metric] !== "number" || !Number.isFinite(runLog.metrics[metric])) {
      throw new Error(`Evolution-enabled run logs must include a finite metrics.${metric} value.`);
    }
  }

  if (runLog.status === "dry-run") {
    const nextState = buildDryRunState(loop, state, runLog, runFile, digest);
    const stateResult = validateData("state", nextState, "updated dry-run ledger");
    if (!stateResult.ok) {
      throw new Error(`Refusing to write invalid dry-run ledger: ${stateResult.errors.join("; ")}`);
    }
    commitLoopTransaction(loop, "record-dry-run", [
      { file: runFile, data: runLog, immutable: true, schema: "run-log" },
      { file: statePath, data: nextState, schema: "state" }
    ]);
    return { runFile, statePath, state: nextState, attention: [], observationOnly: true };
  }

  const nextState = buildRecordedRunState(loop, state, runLog, runFile, digest, utcDay(runLog.finishedAt));

  const stateResult = validateData("state", nextState, "updated state");
  if (!stateResult.ok) {
    throw new Error(`Refusing to write invalid state: ${stateResult.errors.join("; ")}`);
  }

  commitLoopTransaction(loop, "record-run", [
    { file: runFile, data: runLog, immutable: true, schema: "run-log" },
    { file: statePath, data: nextState, schema: "state" }
  ]);

  const attention = nextState.items.filter((item) => item.status === "blocked" || item.status === "needs-human");
  return { runFile, statePath, state: nextState, attention };
}

function buildDryRunState(loop, state, runLog, runFile, digest) {
  return { ...state, recordedRuns: appendRunRecord(loop, state, runLog, runFile, digest) };
}

function buildRecordedRunState(loop, state, runLog, runFile, digest, budgetDate) {
  const recordedDay = state.budgets.date || (state.lastRunAt ? utcDay(state.lastRunAt) : null);
  if (recordedDay !== null && budgetDate < recordedDay) {
    throw new Error("Run accounting day cannot move backward relative to durable state.");
  }
  const rolledOver = recordedDay !== null && recordedDay !== budgetDate;
  const budgets = rolledOver
    ? { date: budgetDate, runsToday: 0, runtimeMinutesToday: 0, estimatedUsdToday: 0 }
    : {
        date: budgetDate,
        runsToday: state.budgets.runsToday,
        runtimeMinutesToday: state.budgets.runtimeMinutesToday,
        estimatedUsdToday: state.budgets.estimatedUsdToday ?? 0
      };
  budgets.runsToday += 1;
  budgets.runtimeMinutesToday += Number(runLog.budget?.runtimeMinutes || 0);
  budgets.estimatedUsdToday += Number(runLog.budget?.estimatedUsd || 0);

  const nextState = {
    apiVersion: "loop-engineering/v1",
    loop: loop.spec.metadata.name,
    generation: state.generation,
    contractSha256: state.contractSha256,
    lastRunAt: runLog.finishedAt || runLog.startedAt,
    paused: state.paused === true,
    pauseReason: state.pauseReason ?? null,
    items: mergeItems(state.items, runLog),
    recordedRuns: appendRunRecord(loop, state, runLog, runFile, digest),
    budgets
  };
  const evolution = updateEvolutionForRun(loop.spec, state.evolution, runLog);
  if (evolution) nextState.evolution = evolution;
  return nextState;
}

function appendRunRecord(loop, state, runLog, runFile, digest) {
  return [
    ...(state.recordedRuns || []),
    {
      runId: runLog.runId,
      artifact: path.relative(loop.loopDir, path.resolve(runFile)).replaceAll("\\", "/"),
      sha256: digest,
      finishedAt: runLog.finishedAt,
      status: runLog.status
    }
  ].slice(-1000);
}

function commitLoopTransaction(loop, operation, writes) {
  const journalPath = loopTransactionPath(loop);
  if (fs.existsSync(journalPath)) {
    throw new Error(`A prior loop transaction must be recovered first: ${journalPath}`);
  }
  const beforeState = readBoundState(loop);
  const journal = {
    apiVersion: "loop-engineering/transaction-v1",
    loop: loop.spec.metadata.name,
    operation,
    createdAt: new Date().toISOString(),
    beforeStateSha256: sha256Json(beforeState),
    beforeState,
    writes: writes.map((entry) => normalizeTransactionWrite(loop, entry))
  };
  validateLoopTransaction(loop, journal);
  preflightImmutableWrites(loop, journal);
  writeJson(journalPath, journal);
  applyLoopTransaction(loop, journal);
  fs.unlinkSync(journalPath);
  fsyncDirectory(path.dirname(journalPath));
}

function recoverLoopTransaction(loop) {
  const journalPath = loopTransactionPath(loop);
  if (!fs.existsSync(journalPath)) return false;
  let journal;
  try {
    journal = readData(journalPath);
  } catch (error) {
    throw new Error(`Loop transaction journal is unreadable; refusing recovery: ${error.message}`);
  }
  validateLoopTransaction(loop, journal);
  preflightImmutableWrites(loop, journal);
  applyLoopTransaction(loop, journal);
  fs.unlinkSync(journalPath);
  fsyncDirectory(path.dirname(journalPath));
  return true;
}

function loopTransactionPath(loop) {
  return path.join(loop.loopDir, "locks", "state-transaction.json");
}

function normalizeTransactionWrite(loop, { file, data, immutable = false, schema = null }) {
  const target = path.resolve(file);
  assertManagedTransactionTarget(loop, target);
  return {
    path: path.relative(loop.loopDir, target).replaceAll("\\", "/"),
    immutable,
    schema,
    sha256: sha256Json(data),
    data
  };
}

function validateLoopTransaction(loop, journal) {
  const allowedOperations = new Set([
    "record-run",
    "record-dry-run",
    "experiment-pending-review",
    "experiment-rejected",
    "experiment-abandoned",
    "experiment-promoted",
    "rollback-strategy"
  ]);
  if (
    !journal
    || journal.apiVersion !== "loop-engineering/transaction-v1"
    || journal.loop !== loop.spec.metadata.name
    || !allowedOperations.has(journal.operation)
    || typeof journal.createdAt !== "string"
    || !/^[a-f0-9]{64}$/.test(journal.beforeStateSha256 || "")
    || journal.beforeStateSha256 !== sha256Json(journal.beforeState)
    || !Array.isArray(journal.writes)
    || journal.writes.length === 0
  ) {
    throw new Error("Loop transaction journal is invalid or belongs to another loop.");
  }
  let journalCreatedAt;
  try {
    journalCreatedAt = parseStateUtcTimestamp(journal.createdAt, "transaction.createdAt");
  } catch {
    throw new Error("Loop transaction journal createdAt must be a valid ISO-8601 UTC timestamp.");
  }
  if (journalCreatedAt > Date.now() + 5 * 60_000) {
    throw new Error("Loop transaction journal createdAt cannot be more than five minutes in the future.");
  }
  const beforeValidation = validateData("state", journal.beforeState, "transaction beforeState");
  if (!beforeValidation.ok || journal.beforeState.loop !== loop.spec.metadata.name) {
    throw new Error(`Loop transaction beforeState is invalid: ${beforeValidation.errors.join("; ")}`);
  }
  const roles = [];
  const targets = new Set();
  for (const entry of journal.writes) {
    if (
      !entry
      || typeof entry.path !== "string"
      || typeof entry.immutable !== "boolean"
      || !["state", "run-log", "strategy", "experiment", "approval", "decision"].includes(entry.schema)
      || entry.sha256 !== sha256Json(entry.data)
    ) {
      throw new Error(`Loop transaction write is invalid: ${entry?.path || "unknown"}`);
    }
    const target = path.resolve(loop.loopDir, entry.path);
    assertManagedTransactionTarget(loop, target);
    if (targets.has(target)) throw new Error(`Loop transaction contains a duplicate target: ${entry.path}`);
    targets.add(target);
    roles.push(transactionWriteRole(loop, entry, target));
    if (entry.schema) {
      const validation = validateData(entry.schema, entry.data, `transaction ${entry.path}`);
      if (!validation.ok) {
        throw new Error(`Loop transaction data is invalid for ${entry.path}: ${validation.errors.join("; ")}`);
      }
    }
    if (entry.data?.loop !== undefined && entry.data.loop !== loop.spec.metadata.name) {
      throw new Error(`Loop transaction data belongs to another loop: ${entry.path}`);
    }
  }
  validateTransactionRoles(journal.operation, roles);
  const stateEntry = journal.writes[roles.indexOf("state")];
  const currentState = readBoundState(loop);
  const currentDigest = sha256Json(currentState);
  if (currentDigest !== journal.beforeStateSha256 && currentDigest !== stateEntry.sha256) {
    throw new Error("Loop transaction precondition does not match current or fully applied state.");
  }
  validateTransactionSemantics(loop, journal, roles);
}

function validateTransactionSemantics(loop, journal, roles) {
  if (journal.operation.startsWith("record-")) {
    validateRunTransactionSemantics(loop, journal, roles);
    return;
  }
  if (journal.operation.startsWith("experiment-")) {
    if (journal.operation === "experiment-abandoned") {
      validateExperimentAbandonTransactionSemantics(loop, journal, roles);
      return;
    }
    validateExperimentTransactionSemantics(loop, journal, roles);
    return;
  }
  if (journal.operation === "rollback-strategy") {
    validateRollbackTransactionSemantics(loop, journal, roles);
  }
}

function validateExperimentAbandonTransactionSemantics(loop, journal, roles) {
  const currentState = journal.beforeState;
  const targetState = journal.writes[roles.indexOf("state")].data;
  const stateEntry = journal.writes[roles.indexOf("state")];
  const decisionEntry = journal.writes[roles.indexOf("decision")];
  const decision = decisionEntry.data;
  const pending = currentState.evolution?.pendingExperiment;
  if (
    !pending
    || pending.experimentId !== decision.experimentId
    || pending.sha256 !== decision.experimentSha256
  ) {
    throw new Error("Experiment rejection transaction is not bound to the exact pending experiment.");
  }
  const priorMatches = (currentState.evolution?.history || []).filter((entry) => (
    entry.experimentId === pending.experimentId
    && entry.sha256 === pending.sha256
    && entry.outcome === "pending-review"
  ));
  if (priorMatches.length !== 1) {
    throw new Error("Pending experiment rejection requires exactly one pending-review history entry.");
  }
  const priorHistory = priorMatches[0];
  const experimentFile = resolveLoopArtifact(loop, priorHistory.artifact, "pending experiment artifact");
  if (sha256Json(readData(experimentFile)) !== pending.sha256) {
    throw new Error("Pending experiment artifact digest does not match durable state.");
  }
  validateIndependentDecisionActor(loop, decision.actor);
  const decidedAt = parseStateUtcTimestamp(decision.decidedAt, "decision.decidedAt");
  const stagedAt = parseStateUtcTimestamp(pending.stagedAt, "pendingExperiment.stagedAt");
  if (decidedAt < stagedAt || decidedAt > Date.now() + 5 * 60_000) {
    throw new Error("Experiment rejection decision time must follow staging and cannot be in the future.");
  }
  const targetMatches = (targetState.evolution?.history || []).filter((entry) => (
    entry.experimentId === pending.experimentId && entry.sha256 === pending.sha256
  ));
  if (targetMatches.length !== 1) {
    throw new Error("Experiment rejection target state must retain exactly one history entry.");
  }
  const expectedHistory = {
    ...priorHistory,
    outcome: "abandoned",
    decision: {
      artifact: decisionEntry.path,
      sha256: decisionEntry.sha256,
      actor: decision.actor,
      decidedAt: decision.decidedAt,
      reason: decision.reason
    }
  };
  if (sha256Json(targetMatches[0]) !== sha256Json(expectedHistory)) {
    throw new Error("Experiment rejection state does not bind its immutable decision artifact.");
  }
  assertStateOutsideEvolutionUnchanged(currentState, targetState, journal.operation);
  const evolution = structuredClone(currentState.evolution || initialEvolutionState());
  evolution.history = evolution.history.map((entry) => (
    entry.experimentId === priorHistory.experimentId
    && entry.sha256 === priorHistory.sha256
    && entry.outcome === "pending-review"
      ? expectedHistory
      : entry
  ));
  evolution.pendingExperiment = null;
  evolution.runsSinceExperiment = 0;
  evolution.consecutiveFailuresSinceExperiment = 0;
  if (sha256Json({ ...currentState, evolution }) !== stateEntry.sha256) {
    throw new Error("Experiment rejection state is not the mechanical pending-review transition.");
  }
}

function validateRunTransactionSemantics(loop, journal, roles) {
  const stateEntry = journal.writes[roles.indexOf("state")];
  const runEntry = journal.writes[roles.indexOf("run-log")];
  const runFile = path.resolve(loop.loopDir, runEntry.path);
  const targetState = stateEntry.data;
  const runLog = runEntry.data;
  const ledger = (targetState.recordedRuns || []).filter((entry) => entry.runId === runLog.runId);
  const expectedArtifact = path.relative(loop.loopDir, runFile).replaceAll("\\", "/");
  if (
    ledger.length !== 1
    || ledger[0].artifact !== expectedArtifact
    || ledger[0].sha256 !== runEntry.sha256
    || ledger[0].status !== runLog.status
    || ledger[0].finishedAt !== runLog.finishedAt
  ) {
    throw new Error(`Loop transaction ${journal.operation} does not bind its run artifact to the state ledger.`);
  }

  const currentState = journal.beforeState;
  validateRunSemantics(loop, runLog, currentState, new Date(journal.createdAt), {
    allowObservedOverrun: runLog.status === "budget-exceeded"
  });
  if (
    (journal.operation === "record-dry-run") !== (runLog.status === "dry-run")
  ) {
    throw new Error(`${journal.operation} transaction has an incompatible run status ${runLog.status}.`);
  }
  const expected = journal.operation === "record-dry-run"
    ? buildDryRunState(loop, currentState, runLog, runFile, runEntry.sha256)
    : buildRecordedRunState(
        loop,
        currentState,
        runLog,
        runFile,
        runEntry.sha256,
        utcDay(runLog.finishedAt)
      );
  if (
    journal.operation === "record-run"
    && targetState.budgets.date !== utcDay(runLog.finishedAt)
  ) {
    throw new Error("record-run transaction accounting date must equal the immutable run completion day.");
  }
  if (sha256Json(expected) !== stateEntry.sha256) {
    throw new Error(`Loop transaction ${journal.operation} state is not the mechanical result of its run artifact.`);
  }
}

function validateExperimentTransactionSemantics(loop, journal, roles) {
  const stateEntry = journal.writes[roles.indexOf("state")];
  const targetState = stateEntry.data;
  const currentState = journal.beforeState;
  const experimentEntry = roles.includes("experiment")
    ? journal.writes[roles.indexOf("experiment")]
    : null;

  if (["experiment-pending-review", "experiment-rejected"].includes(journal.operation)) {
    const experiment = experimentEntry.data;
    if (currentState.evolution?.pendingExperiment || !evolutionPlan(loop.spec, currentState, loop).due) {
      throw new Error(`${journal.operation} transaction was not authorized by a fresh evolution trigger.`);
    }
    validateExperimentProvenance(loop, experiment);
    const digest = experimentEntry.sha256;
    const history = findExperimentHistory(targetState, experiment.experimentId, digest);
    const expectedOutcome = journal.operation === "experiment-pending-review" ? "pending-review" : "rejected";
    if (
      history.outcome !== expectedOutcome
      || history.artifact !== experimentEntry.path
      || history.baselineVersion !== experiment.baseline.version
      || history.candidateVersion !== experiment.candidate.strategy.version
    ) {
      throw new Error(`${journal.operation} transaction history does not bind its experiment artifact.`);
    }
    const strategy = readData(loop.strategyPath);
    const assessment = assessExperiment(loop.spec, strategy, experiment, { now: new Date() });
    if (assessment.outcome !== expectedOutcome || assessment.improvement !== history.improvement) {
      throw new Error(`${journal.operation} transaction outcome is not mechanically derived from its experiment.`);
    }
    assertStateOutsideEvolutionUnchanged(currentState, targetState, journal.operation);
    const evolution = structuredClone(currentState.evolution || initialEvolutionState());
    evolution.history = evolution.history.filter((entry) => entry.experimentId !== experiment.experimentId);
    evolution.history.push(history);
    evolution.history = evolution.history.slice(-1000);
    if (expectedOutcome === "pending-review") {
      evolution.runsSinceExperiment = 0;
      evolution.consecutiveFailuresSinceExperiment = 0;
      evolution.pendingExperiment = {
        experimentId: experiment.experimentId,
        sha256: digest,
        baselineVersion: assessment.baselineVersion,
        candidateVersion: assessment.candidateVersion,
        stagedAt: targetState.evolution.pendingExperiment?.stagedAt
      };
      const stagedAt = parseStateUtcTimestamp(
        evolution.pendingExperiment.stagedAt,
        "pendingExperiment.stagedAt"
      );
      const journalCreatedAt = parseStateUtcTimestamp(journal.createdAt, "transaction.createdAt");
      if (
        stagedAt < experimentLatestEvidenceTime(experiment)
        || Math.abs(stagedAt - journalCreatedAt) > 5 * 60_000
      ) {
        throw new Error("Pending experiment stagedAt must follow its evidence and bind the transaction time.");
      }
    } else if (evolution.pendingExperiment?.experimentId === experiment.experimentId) {
      evolution.pendingExperiment = null;
    } else {
      evolution.runsSinceExperiment = 0;
      evolution.consecutiveFailuresSinceExperiment = 0;
    }
    if (sha256Json({ ...currentState, evolution }) !== stateEntry.sha256) {
      throw new Error(`${journal.operation} transaction state is not the mechanical experiment transition.`);
    }
    return;
  }

  const activeEntry = journal.writes[roles.indexOf("active-strategy")];
  const archiveEntries = journal.writes.filter((_, index) => roles[index] === "strategy-archive");
  const promoted = activeEntry.data;
  const promotedArchive = archiveEntries.find((entry) => entry.data.version === promoted.version);
  if (!promotedArchive || promotedArchive.sha256 !== activeEntry.sha256) {
    throw new Error("Promotion transaction active strategy is not bound to its immutable archive.");
  }
  const history = targetState.evolution?.history?.find((entry) => (
    entry.outcome === "promoted" && entry.candidateVersion === promoted.version
  ));
  if (!history) throw new Error("Promotion transaction is missing its promoted experiment history entry.");
  const experiment = experimentEntry
    ? experimentEntry.data
    : readData(resolveLoopArtifact(loop, history.artifact, "promoted experiment artifact"));
  const experimentDigest = sha256Json(experiment);
  if (
    history.experimentId !== experiment.experimentId
    || history.sha256 !== experimentDigest
    || (experimentEntry && (experimentEntry.sha256 !== experimentDigest || history.artifact !== experimentEntry.path))
  ) {
    throw new Error("Promotion transaction history does not bind its experiment artifact.");
  }
  const approvalEntry = roles.includes("approval") ? journal.writes[roles.indexOf("approval")] : null;
  const approvalRequired = loop.spec.evolution.promotion.mode === "human-review"
    || experiment.recommendation === "needs-human";
  if (approvalRequired && !approvalEntry) {
    throw new Error("Human-reviewed promotion transaction is missing approval evidence.");
  }
  if (approvalEntry) {
    const pending = currentState.evolution?.pendingExperiment;
    if (
      experimentEntry
      || !pending
      || pending.experimentId !== experiment.experimentId
      || pending.sha256 !== experimentDigest
      || pending.baselineVersion !== experiment.baseline.version
      || pending.candidateVersion !== experiment.candidate.strategy.version
    ) {
      throw new Error("Reviewed promotion transaction is not authorized by its exact pending experiment state.");
    }
    const persistedExperimentFile = resolveLoopArtifact(
      loop,
      history.artifact,
      "pending experiment artifact"
    );
    validateApprovalBinding({
      loop,
      approval: approvalEntry.data,
      experiment,
      digest: experimentDigest,
      state: currentState,
      experimentFile: persistedExperimentFile,
      now: new Date()
    });
  } else if (
    currentState.evolution?.pendingExperiment
    || !experimentEntry
    || !evolutionPlan(loop.spec, currentState, loop).due
  ) {
    throw new Error("Automatic promotion transaction was not authorized by a fresh evolution trigger.");
  }
  validateExperimentProvenance(loop, experiment);
  const baseline = archiveEntries.find((entry) => entry.data.version === experiment.baseline.version)?.data;
  if (!baseline) throw new Error("Promotion transaction is missing the benchmark baseline strategy archive.");
  const baselineAnchor = currentState.evolution?.strategyArchives?.find((entry) => entry.version === baseline.version);
  if (!baselineAnchor || baselineAnchor.sha256 !== sha256Json(baseline)) {
    throw new Error("Promotion transaction baseline archive does not match the durable strategy anchor.");
  }
  validatePromotionApprovalRecord(loop, targetState, history, experiment, approvalEntry);
  const assessment = assessExperiment(loop.spec, baseline, experiment, {
    approve: approvalEntry !== null,
    now: new Date()
  });
  const promotedExpected = {
    ...assessment.candidate,
    createdAt: assessment.candidate.createdAt || promoted.createdAt
  };
  if (
    assessment.outcome !== "promoted"
    || assessment.improvement !== history.improvement
    || sha256Json(promotedExpected) !== activeEntry.sha256
    || targetState.evolution.currentStrategyVersion !== promoted.version
    || targetState.evolution.currentStrategySha256 !== activeEntry.sha256
    || targetState.evolution.pendingExperiment !== null
    || targetState.evolution.runsSincePromotion !== 0
    || targetState.evolution.consecutiveFailures !== 0
    || targetState.evolution.runsSinceExperiment !== 0
    || targetState.evolution.consecutiveFailuresSinceExperiment !== 0
  ) {
    throw new Error("Promotion transaction strategy/state is not mechanically derived from its experiment.");
  }
  assertStateOutsideEvolutionUnchanged(currentState, targetState, journal.operation);
  const evolution = structuredClone(currentState.evolution || initialEvolutionState());
  evolution.history = evolution.history.filter((entry) => entry.experimentId !== experiment.experimentId);
  evolution.history.push(history);
  evolution.history = evolution.history.slice(-1000);
  evolution.currentStrategyVersion = promoted.version;
  evolution.currentStrategySha256 = sha256Json(promoted);
  evolution.strategyArchives = upsertStrategyAnchors(evolution.strategyArchives, baseline, promoted);
  evolution.runsSincePromotion = 0;
  evolution.consecutiveFailures = 0;
  evolution.runsSinceExperiment = 0;
  evolution.consecutiveFailuresSinceExperiment = 0;
  evolution.pendingExperiment = null;
  if (sha256Json({ ...currentState, evolution }) !== stateEntry.sha256) {
    throw new Error("Promotion transaction state is not the mechanical evolution transition.");
  }
}

function validateRollbackTransactionSemantics(loop, journal, roles) {
  const stateEntry = journal.writes[roles.indexOf("state")];
  const targetState = stateEntry.data;
  const currentState = journal.beforeState;
  const activeEntry = journal.writes[roles.indexOf("active-strategy")];
  const archives = journal.writes.filter((_, index) => roles[index] === "strategy-archive");
  const restored = activeEntry.data;
  const restoredArchive = archives.find((entry) => entry.data.version === restored.version);
  const rollback = targetState.evolution?.rollbackHistory?.at(-1);
  if (
    !restoredArchive
    || restoredArchive.sha256 !== activeEntry.sha256
    || !rollback
    || rollback.newVersion !== restored.version
    || restored.parentVersion !== rollback.fromVersion
    || targetState.evolution.currentStrategyVersion !== restored.version
    || targetState.evolution.pendingExperiment !== null
    || targetState.evolution.runsSincePromotion !== 0
    || targetState.evolution.consecutiveFailures !== 0
    || targetState.evolution.runsSinceExperiment !== 0
    || targetState.evolution.consecutiveFailuresSinceExperiment !== 0
  ) {
    throw new Error("Rollback transaction does not bind its strategy archive and audit history.");
  }
  const priorArchive = archives.find((entry) => entry.data.version === rollback.fromVersion);
  const sourcePath = path.join(loop.strategyArchiveDir, `v${rollback.restoredFromVersion}.json`);
  const source = readData(sourcePath);
  const sourceAnchor = currentState.evolution?.strategyArchives?.find((entry) => (
    entry.version === rollback.restoredFromVersion
  ));
  if (
    !priorArchive
    || source.version !== rollback.restoredFromVersion
    || source.loop !== loop.spec.metadata.name
    || !sourceAnchor
    || sourceAnchor.sha256 !== sha256Json(source)
    || restored.instructions !== source.instructions
  ) {
    throw new Error("Rollback transaction restored strategy does not match its archived source.");
  }
  assertStateOutsideEvolutionUnchanged(currentState, targetState, journal.operation);
  const evolution = structuredClone(currentState.evolution || initialEvolutionState());
  evolution.currentStrategyVersion = restored.version;
  evolution.currentStrategySha256 = sha256Json(restored);
  evolution.strategyArchives = upsertStrategyAnchors(evolution.strategyArchives, priorArchive.data, restored);
  evolution.runsSincePromotion = 0;
  evolution.consecutiveFailures = 0;
  evolution.runsSinceExperiment = 0;
  evolution.consecutiveFailuresSinceExperiment = 0;
  evolution.pendingExperiment = null;
  evolution.rollbackHistory.push(rollback);
  evolution.rollbackHistory = evolution.rollbackHistory.slice(-1000);
  if (sha256Json({ ...currentState, evolution }) !== stateEntry.sha256) {
    throw new Error("Rollback transaction state is not the mechanical rollback transition.");
  }
}

function findExperimentHistory(state, experimentId, digest) {
  const matches = (state.evolution?.history || []).filter((entry) => (
    entry.experimentId === experimentId && entry.sha256 === digest
  ));
  if (matches.length !== 1) throw new Error("Experiment transaction must bind exactly one state history entry.");
  return matches[0];
}

function assertStateOutsideEvolutionUnchanged(current, target, operation) {
  const currentBase = structuredClone(current);
  const targetBase = structuredClone(target);
  delete currentBase.evolution;
  delete targetBase.evolution;
  if (sha256Json(currentBase) !== sha256Json(targetBase)) {
    throw new Error(`${operation} transaction cannot modify non-evolution state.`);
  }
}

function validatePromotionApprovalRecord(loop, targetState, history, experiment, approvalEntry) {
  const required = loop.spec.evolution.promotion.mode === "human-review"
    || experiment.recommendation === "needs-human";
  if (!approvalEntry) {
    if (required) throw new Error("Human-reviewed promotion transaction is missing approval evidence.");
    return;
  }
  const approval = approvalEntry.data;
  if (
    !history.approval
    || history.approval.artifact !== approvalEntry.path
    || history.approval.sha256 !== approvalEntry.sha256
    || approval.loop !== experiment.loop
    || approval.experimentId !== experiment.experimentId
    || approval.experimentSha256 !== history.sha256
    || approval.baselineVersion !== experiment.baseline.version
    || approval.approver !== history.approval.approver
    || approval.approvedAt !== history.approval.approvedAt
  ) {
    throw new Error("Promotion transaction approval does not bind its experiment and history.");
  }
  const approver = normalizeRole(approval.approver);
  const prohibited = new Set([
    normalizeRole(loop.spec.handoff.worker),
    normalizeRole(loop.spec.verification.evaluator),
    normalizeRole(loop.spec.evolution.evaluator.name)
  ]);
  if (!approver || prohibited.has(approver)) {
    throw new Error("Promotion transaction approver is not independent from configured agent roles.");
  }
  if (!targetState.evolution.history.includes(history)) {
    throw new Error("Promotion transaction approval history is not retained in target state.");
  }
}

function transactionWriteRole(loop, entry, target) {
  if (target === path.resolve(loop.statePath) && entry.schema === "state" && entry.immutable === false) {
    return "state";
  }
  if (isInside(target, loop.runLogDir) && entry.schema === "run-log" && entry.immutable === true) {
    return "run-log";
  }
  if (loop.experimentDir && isInside(target, loop.experimentDir) && entry.schema === "experiment" && entry.immutable === true) {
    return "experiment";
  }
  if (
    loop.experimentDir
    && isInside(target, loop.experimentDir)
    && entry.schema === "approval"
    && entry.immutable === true
    && path.basename(target).endsWith(".approval.json")
  ) {
    return "approval";
  }
  if (
    loop.experimentDir
    && isInside(target, loop.experimentDir)
    && entry.schema === "decision"
    && entry.immutable === true
    && path.basename(target).endsWith(".decision.json")
  ) {
    return "decision";
  }
  if (loop.strategyPath && target === path.resolve(loop.strategyPath) && entry.schema === "strategy" && entry.immutable === false) {
    return "active-strategy";
  }
  if (
    loop.strategyArchiveDir
    && isInside(target, loop.strategyArchiveDir)
    && entry.schema === "strategy"
    && entry.immutable === true
    && path.basename(target) === `v${entry.data?.version}.json`
  ) {
    return "strategy-archive";
  }
  throw new Error(`Loop transaction target/schema/mode is not allowed: ${entry.path}`);
}

function validateTransactionRoles(operation, roles) {
  const counts = new Map();
  for (const role of roles) counts.set(role, (counts.get(role) || 0) + 1);
  const exact = (expected) => {
    const actual = [...roles].sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((value, index) => value === wanted[index]);
  };
  if (["record-run", "record-dry-run"].includes(operation) && exact(["run-log", "state"])) return;
  if (["experiment-pending-review", "experiment-rejected"].includes(operation) && exact(["experiment", "state"])) return;
  if (operation === "experiment-abandoned" && exact(["decision", "state"])) return;
  if (operation === "experiment-promoted") {
    const valid = counts.get("state") === 1
      && counts.get("active-strategy") === 1
      && counts.get("strategy-archive") === 2
      && (counts.get("experiment") || 0) <= 1
      && (counts.get("approval") || 0) <= 1
      && roles.length === 4 + (counts.get("experiment") || 0) + (counts.get("approval") || 0);
    if (valid) return;
  }
  if (operation === "rollback-strategy" && exact([
    "active-strategy",
    "state",
    "strategy-archive",
    "strategy-archive"
  ])) return;
  throw new Error(`Loop transaction ${operation} has an invalid write set: ${roles.join(", ")}`);
}

function isInside(target, directory) {
  const root = path.resolve(directory);
  return target.startsWith(`${root}${path.sep}`);
}

function preflightImmutableWrites(loop, journal) {
  for (const entry of journal.writes) {
    if (!entry.immutable) continue;
    const target = path.resolve(loop.loopDir, entry.path);
    if (!fs.existsSync(target)) continue;
    let existing;
    try {
      existing = readData(target);
    } catch (error) {
      throw new Error(`Immutable transaction target is unreadable: ${target}: ${error.message}`);
    }
    if (sha256Json(existing) !== entry.sha256) {
      throw new Error(`Immutable transaction target differs from the journal: ${target}`);
    }
  }
}

function applyLoopTransaction(loop, journal) {
  for (const entry of journal.writes) {
    const target = path.resolve(loop.loopDir, entry.path);
    assertManagedTransactionTarget(loop, target);
    if (fs.existsSync(target)) {
      const existing = readData(target);
      if (sha256Json(existing) === entry.sha256) continue;
      if (entry.immutable) throw new Error(`Immutable transaction target changed during commit: ${target}`);
    }
    writeJson(target, entry.data);
  }
}

function assertManagedTransactionTarget(loop, target) {
  target = path.resolve(target);
  const lexicalRoot = path.resolve(loop.loopDir);
  if (target === lexicalRoot || !target.startsWith(`${lexicalRoot}${path.sep}`)) {
    throw new Error(`Transaction target must stay inside the loop directory: ${target}`);
  }
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`Cannot resolve transaction target parent: ${target}`);
    existing = parent;
  }
  const realRoot = fs.realpathSync(loop.loopDir);
  const realExisting = fs.realpathSync(existing);
  if (realExisting !== realRoot && !realExisting.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Transaction target real path must stay inside the loop directory: ${target}`);
  }
}

function validateRunSemantics(loop, runLog, state, now, { allowObservedOverrun = false } = {}) {
  const { spec } = loop;
  assertStateTemporalBounds(state, now);
  const startedAt = parseTimestamp(runLog.startedAt, "startedAt");
  const finishedAt = parseTimestamp(runLog.finishedAt, "finishedAt");
  if (finishedAt < startedAt) {
    throw new Error("Run log finishedAt cannot be earlier than startedAt.");
  }
  if (finishedAt > now.getTime() + 5 * 60_000) {
    throw new Error("Run log finishedAt cannot be more than five minutes in the future.");
  }
  if (state.lastRunAt && finishedAt < parseTimestamp(state.lastRunAt, "persisted lastRunAt")) {
    throw new Error("Run log finishedAt cannot be earlier than persisted state.lastRunAt.");
  }
  const latestLedgerEntry = (state.recordedRuns || []).at(-1);
  if (latestLedgerEntry && finishedAt < parseTimestamp(latestLedgerEntry.finishedAt, "latest ledger finishedAt")) {
    throw new Error("Run log finishedAt cannot be earlier than the latest durable run ledger entry.");
  }

  assertUnique(runLog.discovered.map((item) => item.id), "discovered item IDs");
  assertUnique(runLog.results.map((item) => item.itemId), "result item IDs");

  const budgets = spec.safety.budgets;
  const itemsAllowed = Math.min(spec.discovery.maxItemsPerRun, budgets.maxItemsPerRun);
  if (!allowObservedOverrun && runLog.results.length > itemsAllowed) {
    throw new Error(
      `Run log has ${runLog.results.length} results but itemsAllowed is ${itemsAllowed}.`
    );
  }
  if (runLog.discovered.length > itemsAllowed) {
    throw new Error(`Run log discovered ${runLog.discovered.length} items but itemsAllowed is ${itemsAllowed}.`);
  }
  if (!allowObservedOverrun && runLog.budget.itemsAttempted !== runLog.results.length) {
    throw new Error("runLog.budget.itemsAttempted must equal results.length.");
  }
  if (allowObservedOverrun) {
    const costExceeded = typeof budgets.maxEstimatedUsdPerRun === "number"
      && runLog.budget.estimatedUsd > budgets.maxEstimatedUsdPerRun;
    const actuallyExceeded = runLog.budget.runtimeMinutes > budgets.maxRuntimeMinutes
      || runLog.budget.itemsAttempted > itemsAllowed
      || costExceeded;
    if (
      runLog.status !== "budget-exceeded"
      || runLog.failure?.type !== "budget-exceeded"
      || runLog.discovered.length !== 0
      || runLog.results.length !== 0
    ) {
      throw new Error("Trusted budget-exceeded records are accounting-only and cannot contain discovered items or results.");
    }
    if (!actuallyExceeded) {
      throw new Error("Trusted budget-exceeded records must prove at least one configured per-run budget was exceeded.");
    }
  }
  if (!allowObservedOverrun && runLog.budget.runtimeMinutes > budgets.maxRuntimeMinutes) {
    throw new Error(`Run runtime ${runLog.budget.runtimeMinutes} exceeds maxRuntimeMinutes ${budgets.maxRuntimeMinutes}.`);
  }
  if (
    typeof budgets.maxEstimatedUsdPerRun === "number" &&
    runLog.budget.estimatedUsd > budgets.maxEstimatedUsdPerRun
    && !allowObservedOverrun
  ) {
    throw new Error(
      `Run cost $${runLog.budget.estimatedUsd} exceeds maxEstimatedUsdPerRun $${budgets.maxEstimatedUsdPerRun}.`
    );
  }

  const rolledOver = isNewBudgetDay(state, new Date(finishedAt));
  if (runLog.status !== "dry-run" && !rolledOver && state.budgets.runsToday >= budgets.maxDailyRuns) {
    throw new Error(`Daily run budget exhausted (${state.budgets.runsToday}/${budgets.maxDailyRuns}).`);
  }

  if (spec.evolution?.enabled && runLog.results.length > 0) {
    if (
      runLog.strategy?.version !== state.evolution.currentStrategyVersion
      || runLog.strategy?.sha256 !== state.evolution.currentStrategySha256
    ) {
      throw new Error("Evolution-enabled attempted runs must bind the active strategy version and SHA-256.");
    }
  }

  const stateItems = new Map(state.items.map((item) => [item.id, item]));
  const discoveredItems = new Set(runLog.discovered.map((item) => item.id));
  for (const result of runLog.results) {
    const prior = stateItems.get(result.itemId);
    if (!prior && !discoveredItems.has(result.itemId)) {
      throw new Error(`Result item "${result.itemId}" is neither discovered nor present in persisted state.`);
    }
    if (prior) {
      if (!["open", "failed"].includes(prior.status)) {
        throw new Error(`Result item "${result.itemId}" cannot overwrite terminal or active status "${prior.status}".`);
      }
      if (prior.status === "failed" && prior.retries >= spec.safety.retries.maxRetriesPerItem) {
        throw new Error(`Result item "${result.itemId}" has exhausted its retry budget.`);
      }
    }
    validateEvaluatorBinding(loop, result, { startedAt, finishedAt });
  }

  const verdicts = runLog.results.map((result) => result.verdict);
  if (runLog.status === "passed" && (verdicts.length === 0 || verdicts.some((verdict) => verdict !== "pass"))) {
    throw new Error("A passed run requires at least one result and every evaluator verdict must be pass.");
  }
  if (runLog.status === "failed" && verdicts.length === 0 && !runLog.failure) {
    throw new Error("A failed run with no item results must include a failure object.");
  }
  if (runLog.status === "failed" && verdicts.length > 0 && !verdicts.includes("fail")) {
    throw new Error("A failed run with item results must include a fail verdict.");
  }
  if (runLog.status === "blocked" && !verdicts.includes("blocked")) {
    throw new Error("A blocked run must include a blocked verdict.");
  }
  if (runLog.status === "needs-human" && !verdicts.includes("needs-human")) {
    throw new Error("A needs-human run must include a needs-human verdict.");
  }
  if (["no-work", "dry-run"].includes(runLog.status) && runLog.results.length !== 0) {
    throw new Error(`${runLog.status} runs cannot contain attempted item results.`);
  }
  if (runLog.status === "budget-exceeded" && (!allowObservedOverrun || !runLog.failure)) {
    throw new Error("A budget-exceeded run must be recorded by the trusted Runner with failure evidence.");
  }
}

function validateRunReplayEvidence(loop, runLog) {
  const startedAt = parseTimestamp(runLog.startedAt, "startedAt");
  const finishedAt = parseTimestamp(runLog.finishedAt, "finishedAt");
  if (finishedAt < startedAt) throw new Error("Run log finishedAt cannot be earlier than startedAt.");
  for (const result of runLog.results) {
    validateEvaluatorBinding(loop, result, { startedAt, finishedAt });
  }
}

function validateEvaluatorBinding(loop, result, { startedAt, finishedAt }) {
  const artifact = resolveLoopArtifact(loop, result.evaluator.artifact, "evaluator artifact");
  const raw = fs.readFileSync(artifact);
  const digest = sha256Bytes(raw);
  if (digest !== result.evaluator.sha256) {
    throw new Error(`Evaluator artifact digest mismatch for item ${result.itemId}.`);
  }
  let evaluator;
  try {
    evaluator = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error(`Evaluator artifact is not valid JSON ${artifact}: ${error.message}`);
  }
  const validation = validateData("evaluator", evaluator, artifact);
  if (!validation.ok) {
    throw new Error(`Invalid evaluator artifact ${artifact}: ${validation.errors.join("; ")}`);
  }
  if (evaluator.loop !== loop.spec.metadata.name || evaluator.itemId !== result.itemId) {
    throw new Error(`Evaluator artifact identity does not match result item ${result.itemId}.`);
  }
  if (evaluator.verdict !== result.verdict) {
    throw new Error(`Evaluator artifact verdict does not match run-log verdict for ${result.itemId}.`);
  }
  if (evaluator.evaluator.contextId !== result.evaluator.contextId) {
    throw new Error(`Evaluator contextId does not match run-log binding for ${result.itemId}.`);
  }
  const evaluatedAt = parseTimestamp(evaluator.evaluator.evaluatedAt, "evaluator.evaluatedAt");
  if (evaluatedAt < startedAt - 5 * 60_000 || evaluatedAt > finishedAt + 5 * 60_000) {
    throw new Error(`Evaluator timestamp is not bound to the recorded run window for ${result.itemId}.`);
  }
  if (normalizeRole(evaluator.evaluator.identity) === normalizeRole(loop.spec.handoff.worker)) {
    throw new Error(`Evaluator identity must differ from worker identity for ${result.itemId}.`);
  }
  if (normalizeRole(evaluator.evaluator.identity) !== normalizeRole(loop.spec.verification.evaluator)) {
    throw new Error(`Evaluator identity must match verification.evaluator for ${result.itemId}.`);
  }
  assertUniqueEvidenceCommands(evaluator.evidence, `evaluator artifact for ${result.itemId}`);
  if (result.verdict === "pass") {
    for (const required of loop.spec.verification.requiredEvidence) {
      if (!evaluator.evidence.some((evidence) => evidence.type === required)) {
        throw new Error(`Passing evaluator artifact is missing required evidence "${required}" for ${result.itemId}.`);
      }
    }
    for (const command of loop.spec.verification.commands) {
      const evidence = evaluator.evidence.find((item) => item.command === command);
      if (!evidence || evidence.exitCode !== 0) {
        throw new Error(`Passing evaluator artifact lacks successful command evidence: ${command}`);
      }
    }
  }
}

function assertUniqueEvidenceCommands(evidence, label) {
  const commands = evidence
    .filter((entry) => typeof entry?.command === "string")
    .map((entry) => entry.command);
  if (new Set(commands).size !== commands.length) {
    throw new Error(`${label} contains duplicate command evidence.`);
  }
}

function parseTimestamp(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    throw new Error(`Run log ${field} must be an ISO-8601 UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`Run log ${field} is not a valid timestamp.`);
  }
  return parsed;
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Run log contains duplicate ${label}.`);
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

export function recordExperiment(loop, experiment, options = {}) {
  return withLoopStateLock(loop, () => recordExperimentLocked(loop, experiment, options));
}

function recordExperimentLocked(loop, experiment, { approval = null, now = new Date() } = {}) {
  const { spec, statePath, strategyPath, experimentDir, strategyArchiveDir } = loop;
  if (!spec.evolution?.enabled || !strategyPath || !experimentDir) {
    throw new Error("This loop does not enable strategy evolution.");
  }
  assertActiveLeaseAccess(loop, null);

  const experimentResult = validateData("experiment", experiment, "experiment");
  if (!experimentResult.ok) {
    throw new Error(`Experiment does not match protocol/experiment.schema.json: ${experimentResult.errors.join("; ")}`);
  }
  validateExperimentProvenance(loop, experiment);
  const state = readBoundState(loop);
  assertStrategyStateConsistent(loop, state);
  const digest = sha256Json(experiment);
  const priorHistory = state.evolution?.history?.find((entry) => entry.experimentId === experiment.experimentId);
  const experimentFile = experimentArtifactPath(loop, experiment.experimentId, priorHistory);
  if (!priorHistory) {
    if (state.evolution?.pendingExperiment) {
      throw new Error(`Experiment ${state.evolution.pendingExperiment.experimentId} is already pending review; resolve it before staging another candidate.`);
    }
    const plan = evolutionPlan(spec, state, loop);
    if (!plan.due) {
      throw new Error("Strategy evolution is not due under the configured run/failure trigger.");
    }
  }
  if (priorHistory && priorHistory.sha256 !== digest) {
    if (approval !== null && state.evolution?.pendingExperiment?.experimentId === experiment.experimentId) {
      throw new Error("Approval is not bound to the currently pending experiment digest.");
    }
    throw new Error(`Experiment ID is immutable and already belongs to another digest: ${experiment.experimentId}`);
  }

  if (fs.existsSync(experimentFile)) {
    const existing = readData(experimentFile);
    if (sha256Json(existing) !== digest) {
      throw new Error(`Experiment is immutable and already exists with different content: ${experimentFile}`);
    }
    if (!priorHistory) {
      throw new Error(`Experiment artifact exists without a state history entry; refusing ambiguous replay: ${experimentFile}`);
    }
  } else if (priorHistory) {
    throw new Error(`Experiment history references a missing immutable artifact: ${experimentFile}`);
  }

  if (priorHistory) {
    validatePersistedApproval(loop, priorHistory, experiment, digest);
    if (priorHistory.outcome !== "pending-review" || approval === null) {
      if (approval !== null) validateReplayApproval(priorHistory, approval);
      return {
        experimentFile,
        strategyPath,
        statePath,
        assessment: assessmentFromHistory(priorHistory, experiment),
        state,
        sha256: digest,
        replayed: true
      };
    }
  }

  const strategy = readData(strategyPath);
  const strategyResult = validateData("strategy", strategy, strategyPath);
  if (!strategyResult.ok) {
    throw new Error(`Invalid current strategy ${strategyPath}: ${strategyResult.errors.join("; ")}`);
  }
  if (strategy.loop !== spec.metadata.name) {
    throw new Error(`Current strategy loop "${strategy.loop}" does not match spec loop "${spec.metadata.name}".`);
  }
  validateApprovalBinding({ loop, approval, experiment, digest, state, experimentFile, now });

  const assessment = assessExperiment(spec, strategy, experiment, { approve: approval !== null, now });
  if (priorHistory?.outcome === "pending-review" && approval !== null && assessment.outcome !== "promoted") {
    throw new Error("The staged experiment no longer qualifies under the current immutable contract; approval is invalidated and a new experiment must be staged.");
  }

  const evolution = structuredClone(state.evolution || initialEvolutionState());
  evolution.history = evolution.history.filter((entry) => entry.experimentId !== experiment.experimentId);
  const historyEntry = {
    experimentId: experiment.experimentId,
    sha256: digest,
    outcome: assessment.outcome,
    baselineVersion: assessment.baselineVersion,
    candidateVersion: assessment.candidateVersion,
    improvement: assessment.improvement,
    artifact: path.relative(loop.loopDir, experimentFile).replaceAll("\\", "/")
  };
  const approvalFile = path.join(experimentDir, `${artifactStem(experiment.experimentId)}.approval.json`);
  if (approval !== null && assessment.outcome === "promoted") {
    historyEntry.approval = {
      artifact: path.relative(loop.loopDir, approvalFile).replaceAll("\\", "/"),
      sha256: sha256Json(approval),
      approver: approval.approver,
      approvedAt: approval.approvedAt
    };
  }
  evolution.history.push(historyEntry);
  evolution.history = evolution.history.slice(-1000);

  let promoted = null;
  if (assessment.outcome === "promoted") {
    promoted = {
      ...assessment.candidate,
      createdAt: assessment.candidate.createdAt || now.toISOString()
    };
    evolution.currentStrategyVersion = promoted.version;
    evolution.currentStrategySha256 = sha256Json(promoted);
    evolution.strategyArchives = upsertStrategyAnchors(evolution.strategyArchives, strategy, promoted);
    evolution.runsSincePromotion = 0;
    evolution.consecutiveFailures = 0;
    evolution.runsSinceExperiment = 0;
    evolution.consecutiveFailuresSinceExperiment = 0;
    evolution.pendingExperiment = null;
  } else if (assessment.outcome === "pending-review") {
    evolution.runsSinceExperiment = 0;
    evolution.consecutiveFailuresSinceExperiment = 0;
    evolution.pendingExperiment = {
      experimentId: experiment.experimentId,
      sha256: digest,
      baselineVersion: assessment.baselineVersion,
      candidateVersion: assessment.candidateVersion,
      stagedAt: now.toISOString()
    };
  } else if (evolution.pendingExperiment?.experimentId === experiment.experimentId) {
    evolution.pendingExperiment = null;
  } else {
    evolution.runsSinceExperiment = 0;
    evolution.consecutiveFailuresSinceExperiment = 0;
  }

  const nextState = { ...state, evolution };
  const stateResult = validateData("state", nextState, "updated state");
  if (!stateResult.ok) {
    throw new Error(`Refusing to write invalid state: ${stateResult.errors.join("; ")}`);
  }

  const experimentWrite = fs.existsSync(experimentFile)
    ? []
    : [{ file: experimentFile, data: experiment, immutable: true, schema: "experiment" }];
  if (assessment.outcome === "promoted") {
    const writes = [
      ...experimentWrite,
      ...(approval === null ? [] : [{ file: approvalFile, data: approval, immutable: true, schema: "approval" }]),
      { file: path.join(strategyArchiveDir, `v${strategy.version}.json`), data: strategy, immutable: true, schema: "strategy" },
      { file: path.join(strategyArchiveDir, `v${promoted.version}.json`), data: promoted, immutable: true, schema: "strategy" },
      { file: strategyPath, data: promoted, schema: "strategy" },
      { file: statePath, data: nextState, schema: "state" }
    ];
    commitLoopTransaction(loop, "experiment-promoted", writes);
  } else {
    commitLoopTransaction(
      loop,
      assessment.outcome === "pending-review" ? "experiment-pending-review" : "experiment-rejected",
      [...experimentWrite, { file: statePath, data: nextState, schema: "state" }]
    );
  }
  return { experimentFile, strategyPath, statePath, assessment, state: nextState, sha256: digest };
}

function assessmentFromHistory(history, experiment) {
  return {
    outcome: history.outcome,
    improvement: history.improvement,
    candidate: experiment.candidate.strategy,
    baselineVersion: history.baselineVersion,
    candidateVersion: history.candidateVersion
  };
}

export function rejectPendingExperiment(
  loop,
  experiment,
  { actor, reason, now = new Date() } = {}
) {
  return withLoopStateLock(loop, () => {
    if (!loop.spec.evolution?.enabled || !loop.experimentDir) {
      throw new Error("This loop does not enable strategy evolution.");
    }
    assertActiveLeaseAccess(loop, null);
    const validation = validateData("experiment", experiment, "experiment");
    if (!validation.ok) {
      throw new Error(`Experiment does not match protocol/experiment.schema.json: ${validation.errors.join("; ")}`);
    }
    if (experiment.loop !== loop.spec.metadata.name) {
      throw new Error("Experiment belongs to another loop.");
    }
    if (typeof reason !== "string" || reason.trim().length < 3) {
      throw new Error("Rejecting a pending experiment requires a meaningful reason.");
    }
    validateIndependentDecisionActor(loop, actor);
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error("Experiment decision clock must be a valid Date.");
    }
    const state = readBoundState(loop);
    assertStrategyStateConsistent(loop, state);
    const digest = sha256Json(experiment);
    const pending = state.evolution?.pendingExperiment;
    if (
      !pending
      || pending.experimentId !== experiment.experimentId
      || pending.sha256 !== digest
      || pending.baselineVersion !== experiment.baseline.version
      || pending.candidateVersion !== experiment.candidate.strategy.version
    ) {
      throw new Error("Human rejection must bind the exact pending experiment digest and versions.");
    }
    const matches = state.evolution.history.filter((entry) => (
      entry.experimentId === experiment.experimentId
      && entry.sha256 === digest
      && entry.outcome === "pending-review"
    ));
    if (matches.length !== 1) {
      throw new Error("Pending experiment is not bound to exactly one pending-review history entry.");
    }
    const history = matches[0];
    const experimentFile = experimentArtifactPath(loop, experiment.experimentId, history);
    if (!fs.existsSync(experimentFile) || sha256Json(readData(experimentFile)) !== digest) {
      throw new Error("Pending experiment artifact is missing or no longer matches its durable digest.");
    }
    const stagedAt = parseStateUtcTimestamp(pending.stagedAt, "pendingExperiment.stagedAt");
    if (now.getTime() < stagedAt || now.getTime() > Date.now() + 5 * 60_000) {
      throw new Error("Experiment rejection must occur after staging and cannot be in the future.");
    }
    const decision = {
      apiVersion: "loop-engineering/v1",
      loop: loop.spec.metadata.name,
      experimentId: experiment.experimentId,
      experimentSha256: digest,
      decision: "reject",
      actor: actor.trim(),
      decidedAt: now.toISOString(),
      reason: reason.trim()
    };
    const decisionValidation = validateData("decision", decision, "experiment decision");
    if (!decisionValidation.ok) {
      throw new Error(`Refusing invalid experiment decision: ${decisionValidation.errors.join("; ")}`);
    }
    const decisionFile = path.join(loop.experimentDir, `${artifactStem(experiment.experimentId)}.decision.json`);
    const evolution = structuredClone(state.evolution);
    evolution.history = evolution.history.map((entry) => (
      entry.experimentId === experiment.experimentId
      && entry.sha256 === digest
      && entry.outcome === "pending-review"
        ? {
            ...entry,
            outcome: "abandoned",
            decision: {
              artifact: path.relative(loop.loopDir, decisionFile).replaceAll("\\", "/"),
              sha256: sha256Json(decision),
              actor: decision.actor,
              decidedAt: decision.decidedAt,
              reason: decision.reason
            }
          }
        : entry
    ));
    evolution.pendingExperiment = null;
    evolution.runsSinceExperiment = 0;
    evolution.consecutiveFailuresSinceExperiment = 0;
    const nextState = { ...state, evolution };
    const stateValidation = validateData("state", nextState, "updated state");
    if (!stateValidation.ok) {
      throw new Error(`Refusing invalid experiment rejection state: ${stateValidation.errors.join("; ")}`);
    }
    commitLoopTransaction(loop, "experiment-abandoned", [
      { file: decisionFile, data: decision, immutable: true, schema: "decision" },
      { file: loop.statePath, data: nextState, schema: "state" }
    ]);
    return { statePath: loop.statePath, decisionFile, state: nextState, decision };
  });
}

function validateIndependentDecisionActor(loop, actor) {
  const normalized = normalizeRole(actor);
  const prohibited = new Set([
    normalizeRole(loop.spec.handoff.worker),
    normalizeRole(loop.spec.verification.evaluator),
    normalizeRole(loop.spec.evolution?.evaluator?.name)
  ]);
  if (!normalized || prohibited.has(normalized)) {
    throw new Error("Experiment decision actor must be independent from configured worker and evaluator identities.");
  }
}

export function rollbackStrategy(loop, version, options = {}) {
  return withLoopStateLock(loop, () => rollbackStrategyLocked(loop, version, options));
}

function rollbackStrategyLocked(loop, version, { actor, reason, now = new Date() } = {}) {
  const { spec, statePath, strategyPath, strategyArchiveDir } = loop;
  if (!spec.evolution?.enabled || !strategyPath || !strategyArchiveDir) {
    throw new Error("This loop does not enable strategy evolution.");
  }
  assertActiveLeaseAccess(loop, null);
  if (!Number.isInteger(version) || version < 1) throw new Error("Rollback target version must be a positive integer.");
  if (typeof actor !== "string" || actor.trim().length === 0) throw new Error("Rollback requires --actor.");
  if (typeof reason !== "string" || reason.trim().length < 3) throw new Error("Rollback requires a meaningful --reason.");

  const state = readBoundState(loop);
  assertStrategyStateConsistent(loop, state);
  if (state.evolution?.pendingExperiment) {
    throw new Error("Reject or approve the pending experiment before rolling back the active strategy.");
  }
  const current = readData(strategyPath);
  const currentValidation = validateData("strategy", current, strategyPath);
  if (!currentValidation.ok) throw new Error(`Active strategy is invalid: ${currentValidation.errors.join("; ")}`);
  if (current.loop !== spec.metadata.name) throw new Error("Active strategy belongs to a different loop.");
  const targetPath = path.join(strategyArchiveDir, `v${version}.json`);
  if (!fs.existsSync(targetPath)) throw new Error(`Archived strategy v${version} not found: ${targetPath}`);
  const target = readData(targetPath);
  const targetValidation = validateData("strategy", target, targetPath);
  if (!targetValidation.ok) throw new Error(`Archived strategy v${version} is invalid: ${targetValidation.errors.join("; ")}`);
  if (target.loop !== spec.metadata.name) throw new Error("Rollback strategy belongs to a different loop.");
  if (target.version !== version) throw new Error(`Archived strategy filename v${version} does not match payload v${target.version}.`);
  const targetAnchor = state.evolution.strategyArchives.find((entry) => entry.version === version);
  if (!targetAnchor || targetAnchor.sha256 !== sha256Json(target)) {
    throw new Error(`Archived strategy v${version} is not retained in the durable digest ledger.`);
  }
  if (target.version === current.version) throw new Error(`Strategy v${version} is already active.`);

  const restored = {
    ...target,
    version: current.version + 1,
    parentVersion: current.version,
    hypothesis: `Rollback to the behavior of v${target.version}: ${reason.trim()}`,
    createdAt: now.toISOString()
  };
  const evolution = structuredClone(state.evolution || initialEvolutionState());
  evolution.currentStrategyVersion = restored.version;
  evolution.currentStrategySha256 = sha256Json(restored);
  evolution.strategyArchives = upsertStrategyAnchors(evolution.strategyArchives, current, restored);
  evolution.runsSincePromotion = 0;
  evolution.consecutiveFailures = 0;
  evolution.runsSinceExperiment = 0;
  evolution.consecutiveFailuresSinceExperiment = 0;
  evolution.pendingExperiment = null;
  evolution.rollbackHistory.push({
    fromVersion: current.version,
    restoredFromVersion: target.version,
    newVersion: restored.version,
    actor: actor.trim(),
    reason: reason.trim(),
    at: now.toISOString()
  });
  evolution.rollbackHistory = evolution.rollbackHistory.slice(-1000);
  const nextState = { ...state, evolution };
  const stateValidation = validateData("state", nextState, "updated state");
  if (!stateValidation.ok) throw new Error(`Refusing to write invalid rollback state: ${stateValidation.errors.join("; ")}`);

  commitLoopTransaction(loop, "rollback-strategy", [
    { file: path.join(strategyArchiveDir, `v${current.version}.json`), data: current, immutable: true, schema: "strategy" },
    { file: path.join(strategyArchiveDir, `v${restored.version}.json`), data: restored, immutable: true, schema: "strategy" },
    { file: strategyPath, data: restored, schema: "strategy" },
    { file: statePath, data: nextState, schema: "state" }
  ]);
  return { strategyPath, statePath, restoredFromVersion: target.version, strategy: restored, state: nextState };
}

function upsertStrategyAnchors(prior = [], ...strategies) {
  const byVersion = new Map(prior.map((entry) => [entry.version, { ...entry }]));
  for (const strategy of strategies) {
    const anchored = { version: strategy.version, sha256: sha256Json(strategy) };
    const existing = byVersion.get(strategy.version);
    if (existing && existing.sha256 !== anchored.sha256) {
      throw new Error(`Strategy archive anchor v${strategy.version} conflicts with the strategy being recorded.`);
    }
    byVersion.set(strategy.version, anchored);
  }
  return [...byVersion.values()].sort((left, right) => left.version - right.version).slice(-1000);
}

function validateApprovalBinding({ loop, approval, experiment, digest, state, experimentFile, now }) {
  if (approval === null) return;
  const validation = validateData("approval", approval, "approval");
  if (!validation.ok) {
    throw new Error(`Approval does not match protocol/approval.schema.json: ${validation.errors.join("; ")}`);
  }
  const pending = state.evolution?.pendingExperiment;
  if (!pending || pending.experimentId !== experiment.experimentId || pending.sha256 !== digest) {
    throw new Error("Approval is not bound to the currently pending experiment digest.");
  }
  if (
    approval.loop !== experiment.loop ||
    approval.experimentId !== experiment.experimentId ||
    approval.experimentSha256 !== digest ||
    approval.baselineVersion !== experiment.baseline.version
  ) {
    throw new Error("Approval fields do not match the staged experiment.");
  }
  const approver = normalizeRole(approval.approver);
  const prohibited = new Set([
    normalizeRole(loop.spec.handoff.worker),
    normalizeRole(loop.spec.verification.evaluator),
    normalizeRole(loop.spec.evolution?.evaluator?.name)
  ]);
  if (!approver || prohibited.has(approver)) {
    throw new Error("Strategy approver must be independent from configured worker and evaluator identities.");
  }
  let approvedAt;
  try {
    approvedAt = parseStateUtcTimestamp(approval.approvedAt, "approval.approvedAt");
  } catch {
    throw new Error("Approval approvedAt must be a valid ISO-8601 UTC timestamp.");
  }
  if (approvedAt > now.getTime() + 5 * 60_000) throw new Error("Approval approvedAt cannot be in the future.");
  const stagedAt = Date.parse(pending.stagedAt);
  if (approvedAt < stagedAt || approvedAt < experimentLatestEvidenceTime(experiment)) {
    throw new Error("Approval cannot predate the staged experiment.");
  }
  if (!fs.existsSync(experimentFile)) {
    throw new Error(`Pending experiment artifact not found: ${experimentFile}`);
  }
  const staged = readData(experimentFile);
  if (sha256Json(staged) !== digest) {
    throw new Error("Staged experiment artifact has changed since review; approval is invalid.");
  }
}

function experimentLatestEvidenceTime(experiment) {
  const values = [parseStateUtcTimestamp(experiment.evaluator.evaluatedAt, "experiment.evaluator.evaluatedAt")];
  if (experiment.candidate.strategy.createdAt !== null) {
    values.push(parseStateUtcTimestamp(experiment.candidate.strategy.createdAt, "candidate.strategy.createdAt"));
  }
  for (const arm of [experiment.baseline, experiment.candidate]) {
    for (const result of arm.results) {
      values.push(parseStateUtcTimestamp(
        result.evaluation.evaluatedAt,
        `benchmark[${result.caseId}].evaluation.evaluatedAt`
      ));
    }
  }
  return Math.max(...values);
}

function experimentArtifactPath(loop, experimentId, history = null) {
  if (history?.artifact) {
    const target = path.resolve(loop.loopDir, history.artifact);
    assertExperimentTarget(loop, target);
    return target;
  }
  const current = path.join(loop.experimentDir, `${artifactStem(experimentId)}.json`);
  if (!history || fs.existsSync(current)) return current;
  const legacy = path.join(loop.experimentDir, `${legacyArtifactStem(experimentId)}.json`);
  if (fs.existsSync(legacy)) return legacy;
  return current;
}

function assertExperimentTarget(loop, target) {
  assertManagedTransactionTarget(loop, target);
  if (!isInside(target, loop.experimentDir) || !path.basename(target).endsWith(".json")) {
    throw new Error(`Experiment artifact must stay inside the configured experiment directory: ${target}`);
  }
}

function validatePersistedApproval(loop, history, experiment, digest) {
  const required = history.outcome === "promoted" && (
    loop.spec.evolution?.promotion?.mode === "human-review"
    || experiment.recommendation === "needs-human"
  );
  if (!history.approval) {
    if (required) throw new Error("Promoted human-reviewed experiment is missing its persisted approval artifact.");
    return;
  }
  const artifact = resolveLoopArtifact(loop, history.approval.artifact, "persisted approval artifact");
  const approval = readData(artifact);
  const validation = validateData("approval", approval, artifact);
  if (!validation.ok) throw new Error(`Persisted approval artifact is invalid: ${validation.errors.join("; ")}`);
  if (
    sha256Json(approval) !== history.approval.sha256
    || approval.loop !== experiment.loop
    || approval.experimentId !== experiment.experimentId
    || approval.experimentSha256 !== digest
    || approval.approver !== history.approval.approver
    || approval.approvedAt !== history.approval.approvedAt
  ) {
    throw new Error("Persisted approval artifact does not match evolution history.");
  }
}

function validateReplayApproval(history, approval) {
  if (!history.approval || sha256Json(approval) !== history.approval.sha256) {
    throw new Error("Replay approval does not match the immutable promoted approval artifact.");
  }
}

function validateExperimentProvenance(loop, experiment) {
  const manifestPath = resolveLoopArtifact(loop, experiment.benchmark.manifest, "benchmark manifest");
  const manifestRaw = fs.readFileSync(manifestPath);
  if (sha256Bytes(manifestRaw) !== experiment.benchmark.sha256) {
    throw new Error("Benchmark manifest digest does not match experiment.benchmark.sha256.");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw.toString("utf8"));
  } catch (error) {
    throw new Error(`Benchmark manifest is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(manifest.caseIds) || !sameStringSet(manifest.caseIds, experiment.benchmark.caseIds)) {
    throw new Error("Benchmark manifest caseIds do not match the experiment benchmark.");
  }
  for (const arm of [experiment.baseline, experiment.candidate]) {
    for (const result of arm.results) {
      const artifact = resolveLoopArtifact(loop, result.artifact, `benchmark case ${result.caseId}`);
      const raw = fs.readFileSync(artifact);
      if (sha256Bytes(raw) !== result.sha256) {
        throw new Error(`Benchmark artifact digest mismatch for case ${result.caseId}.`);
      }
      let recorded;
      try {
        recorded = JSON.parse(raw.toString("utf8"));
      } catch (error) {
        throw new Error(`Benchmark artifact for case ${result.caseId} is not valid JSON: ${error.message}`);
      }
      const expected = {
        caseId: result.caseId,
        score: result.score,
        verdict: result.verdict,
        evaluation: result.evaluation
      };
      if (sha256Json(recorded) !== sha256Json(expected)) {
        throw new Error(`Benchmark artifact content does not match the recorded result for case ${result.caseId}.`);
      }
    }
  }
}

function resolveLoopArtifact(loop, value, label) {
  const target = path.isAbsolute(value) ? path.resolve(value) : path.resolve(loop.loopDir, value);
  const lexicalRoot = `${path.resolve(loop.loopDir)}${path.sep}`;
  if (!target.startsWith(lexicalRoot)) throw new Error(`${label} must be stored inside the loop directory.`);
  if (!fs.existsSync(target)) throw new Error(`${label} not found: ${target}`);
  const realRoot = fs.realpathSync(loop.loopDir);
  const realTarget = fs.realpathSync(target);
  if (!realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${label} real path must stay inside the loop directory.`);
  }
  if (!fs.statSync(realTarget).isFile()) throw new Error(`${label} must be a regular file.`);
  return realTarget;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertActiveLeaseAccess(
  loop,
  leaseToken,
  { required = false, runId = null, now = new Date(), state = null } = {}
) {
  const leasePath = path.join(loop.loopDir, "locks", "active-run.json");
  if (!fs.existsSync(leasePath)) {
    if (required) throw new Error("Trusted Runner mutation requires an active lease.");
    return null;
  }
  let lease;
  try {
    lease = readData(leasePath);
  } catch (error) {
    throw new Error(`Active lease is unreadable; refusing state mutation: ${error.message}`);
  }
  if (
    !lease
    || typeof lease !== "object"
    || typeof lease.token !== "string"
    || lease.token.length === 0
    || typeof lease.runId !== "string"
    || lease.runId.trim().length === 0
    || typeof lease.generation !== "string"
    || lease.generation.length === 0
    || !/^[a-f0-9]{64}$/.test(lease.contractSha256 || "")
    || !Number.isInteger(lease.pid)
    || lease.pid < 1
    || typeof lease.hostname !== "string"
    || lease.hostname.length === 0
  ) {
    throw new Error("Active lease is invalid; refusing state mutation.");
  }
  let startedAt;
  let heartbeatAt;
  let expiresAt;
  try {
    startedAt = parseStateUtcTimestamp(lease.startedAt, "lease.startedAt");
    heartbeatAt = parseStateUtcTimestamp(lease.heartbeatAt, "lease.heartbeatAt");
    expiresAt = parseStateUtcTimestamp(lease.expiresAt, "lease.expiresAt");
  } catch {
    throw new Error("Active lease is invalid; refusing state mutation.");
  }
  if (heartbeatAt < startedAt || expiresAt <= heartbeatAt) {
    throw new Error("Active lease is invalid; refusing state mutation.");
  }
  if (leaseToken !== lease.token) {
    throw new Error(`Loop is owned by active run ${lease.runId || "unknown"}; external recording is blocked.`);
  }
  if (runId !== null && lease.runId !== runId) {
    throw new Error(`Active lease runId "${lease.runId || "unknown"}" does not match record "${runId}".`);
  }
  if (state && (lease.generation !== state.generation || lease.contractSha256 !== state.contractSha256)) {
    throw new Error("Active lease generation/contract binding does not match durable loop state.");
  }
  if (required && expiresAt <= now.getTime()) {
    throw new Error(`Active lease for run ${lease.runId} has expired; trusted mutation is blocked.`);
  }
  return lease;
}

function assertStateBinding(loop, state) {
  if (typeof state.generation !== "string" || typeof state.contractSha256 !== "string") {
    throw new Error("Loop state predates v1.0.2 integrity bindings; run `loopctl migrate <loop-dir>` before continuing.");
  }
  if (loop.resolvedGeneration !== null && state.generation !== loop.resolvedGeneration) {
    throw new Error("Loop state generation changed after this runtime handle was resolved; re-resolve the loop before continuing.");
  }
  const contractDigest = sha256Json(loop.spec);
  if (state.contractSha256 !== contractDigest || loop.resolvedContractSha256 !== contractDigest) {
    throw new Error("loop.yaml digest does not match the durable state contract binding.");
  }
  if (
    state.evolution
    && (
      !Number.isInteger(state.evolution.runsSinceExperiment)
      || state.evolution.runsSinceExperiment < 0
      || !Number.isInteger(state.evolution.consecutiveFailuresSinceExperiment)
      || state.evolution.consecutiveFailuresSinceExperiment < 0
    )
  ) {
    throw new Error("Evolution state predates v1.0.2 experiment-trigger counters; run `loopctl migrate <loop-dir>`.");
  }
}

function assertStrategyStateConsistent(loop, state) {
  if (!loop.spec.evolution?.enabled) return;
  if (!loop.strategyPath || !fs.existsSync(loop.strategyPath)) {
    throw new Error("Evolution is enabled but the active strategy file is missing.");
  }
  const strategy = readData(loop.strategyPath);
  const validation = validateData("strategy", strategy, loop.strategyPath);
  if (!validation.ok) {
    throw new Error(`Active strategy is invalid: ${validation.errors.join("; ")}`);
  }
  if (
    strategy.loop !== loop.spec.metadata.name
    || state.evolution?.currentStrategyVersion !== strategy.version
    || state.evolution?.currentStrategySha256 !== sha256Json(strategy)
  ) {
    throw new Error("Active strategy identity/version/digest does not match persisted evolution state.");
  }
  const anchors = state.evolution?.strategyArchives;
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new Error("Evolution state is missing immutable strategy archive anchors.");
  }
  const versions = anchors.map((entry) => entry.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error("Evolution state contains duplicate strategy archive anchors.");
  }
  for (const anchor of anchors) {
    const archivePath = path.join(loop.strategyArchiveDir, `v${anchor.version}.json`);
    if (!fs.existsSync(archivePath)) throw new Error(`Anchored strategy archive is missing: ${archivePath}`);
    const archived = readData(archivePath);
    const archivedValidation = validateData("strategy", archived, archivePath);
    if (
      !archivedValidation.ok
      || archived.loop !== loop.spec.metadata.name
      || archived.version !== anchor.version
      || sha256Json(archived) !== anchor.sha256
    ) {
      throw new Error(`Strategy archive v${anchor.version} does not match its persisted digest anchor.`);
    }
  }
  const currentArchive = anchors.find((entry) => entry.version === strategy.version);
  if (!currentArchive || currentArchive.sha256 !== state.evolution.currentStrategySha256) {
    throw new Error("Active strategy digest is not retained in the immutable archive ledger.");
  }
}

function sameStringSet(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function mergeItems(existing, runLog) {
  const byId = new Map(existing.map((item) => [item.id, { ...item }]));

  for (const result of runLog.results) {
    const status = VERDICT_TO_STATUS.get(result.verdict);
    const prior = byId.get(result.itemId);
    if (prior) {
      const wasFailed = prior.status === "failed";
      prior.status = status;
      if (result.verdict === "fail" && wasFailed) {
        prior.retries += 1;
      }
      if (result.summary) {
        prior.summary = result.summary;
      }
      byId.set(result.itemId, prior);
    } else {
      const item = { id: result.itemId, status, retries: 0 };
      const discovered = runLog.discovered.find((entry) => entry.id === result.itemId);
      if (discovered?.source) {
        item.source = discovered.source;
      }
      if (result.summary) {
        item.summary = result.summary;
      } else if (discovered?.summary) {
        item.summary = discovered.summary;
      }
      byId.set(result.itemId, item);
    }
  }

  for (const discovered of runLog.discovered) {
    const id = discovered.id;
    if (!id || byId.has(id)) {
      continue;
    }
    const item = { id, status: "open", retries: 0 };
    if (discovered.summary) {
      item.summary = discovered.summary;
    }
    if (discovered.source) {
      item.source = discovered.source;
    }
    byId.set(id, item);
  }

  return [...byId.values()];
}

function isNewBudgetDay(state, now) {
  const recordedDay = state.budgets.date || (state.lastRunAt ? utcDay(new Date(state.lastRunAt)) : null);
  return recordedDay !== null && recordedDay !== utcDay(now);
}

function utcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Cannot derive a UTC accounting day from an invalid timestamp.");
  return date.toISOString().slice(0, 10);
}

function artifactStem(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_-]{1,128}$/.test(text)) return `raw-${text}`;
  const readable = text.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "artifact";
  return `encoded-${readable}-${crypto.createHash("sha256").update(text).digest("hex")}`;
}

function legacyArtifactStem(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}
