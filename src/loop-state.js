import fs from "node:fs";
import path from "node:path";
import { readData, writeJson } from "./fs-utils.js";
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

  return { spec, specPath, loopDir, statePath, runLogDir, inboxPath };
}

function pickPath(colocated, declared) {
  return fs.existsSync(colocated) ? colocated : declared;
}

export function readState(statePath, loopName) {
  if (!fs.existsSync(statePath)) {
    return {
      apiVersion: "loop-engineering/v1",
      loop: loopName,
      lastRunAt: null,
      items: [],
      budgets: { runsToday: 0, runtimeMinutesToday: 0, estimatedUsdToday: 0 }
    };
  }
  const state = readData(statePath);
  const result = validateData("state", state, statePath);
  if (!result.ok) {
    throw new Error(`Invalid state file ${statePath}: ${result.errors.join("; ")}`);
  }
  return state;
}

export function nextRun(loop, now = new Date()) {
  const { spec, statePath } = loop;
  const state = readState(statePath, spec.metadata.name);
  const budgets = spec.safety.budgets;
  const retries = spec.safety.retries;

  const rolledOver = isNewUtcDay(state.lastRunAt, now);
  const runsToday = rolledOver ? 0 : state.budgets.runsToday;
  const runtimeMinutesToday = rolledOver ? 0 : state.budgets.runtimeMinutesToday;
  const estimatedUsdToday = rolledOver ? 0 : (state.budgets.estimatedUsdToday ?? 0);

  const reasons = [];
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
    if (item.retries > retries.maxRetriesPerItem) {
      exhausted.push({ id: item.id, retries: item.retries, action: retries.onRepeatedFailure });
    } else {
      retryQueue.push({ id: item.id, status: item.status, retries: item.retries });
    }
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
    stopConditions: spec.goal.stopConditions
  };
}

export function recordRun(loop, runLog, { force = false, now = new Date() } = {}) {
  const { spec, statePath, runLogDir } = loop;

  const runResult = validateData("run-log", runLog, "run log");
  if (!runResult.ok) {
    throw new Error(`Run log does not match protocol/run-log.schema.json: ${runResult.errors.join("; ")}`);
  }
  if (runLog.loop !== spec.metadata.name) {
    throw new Error(`Run log loop "${runLog.loop}" does not match spec loop "${spec.metadata.name}".`);
  }
  if (runLog.results.length > spec.safety.budgets.maxItemsPerRun) {
    throw new Error(
      `Run log has ${runLog.results.length} results but safety.budgets.maxItemsPerRun is ${spec.safety.budgets.maxItemsPerRun}.`
    );
  }

  const runFile = path.join(runLogDir, `${slugify(runLog.runId)}.json`);
  if (fs.existsSync(runFile) && !force) {
    throw new Error(`Run log already exists: ${runFile}. Pass --force to overwrite.`);
  }

  const state = readState(statePath, spec.metadata.name);
  const rolledOver = isNewUtcDay(state.lastRunAt, now);
  const budgets = rolledOver
    ? { runsToday: 0, runtimeMinutesToday: 0, estimatedUsdToday: 0 }
    : {
        runsToday: state.budgets.runsToday,
        runtimeMinutesToday: state.budgets.runtimeMinutesToday,
        estimatedUsdToday: state.budgets.estimatedUsdToday ?? 0
      };

  budgets.runsToday += 1;
  budgets.runtimeMinutesToday += Number(runLog.budget?.runtimeMinutes || 0);
  budgets.estimatedUsdToday += Number(runLog.budget?.estimatedUsd || 0);

  const items = mergeItems(state.items, runLog);

  const nextState = {
    apiVersion: "loop-engineering/v1",
    loop: spec.metadata.name,
    lastRunAt: runLog.finishedAt || runLog.startedAt,
    items,
    budgets
  };

  const stateResult = validateData("state", nextState, "updated state");
  if (!stateResult.ok) {
    throw new Error(`Refusing to write invalid state: ${stateResult.errors.join("; ")}`);
  }

  writeJson(runFile, runLog);
  writeJson(statePath, nextState);

  const attention = items.filter((item) => item.status === "blocked" || item.status === "needs-human");
  return { runFile, statePath, state: nextState, attention };
}

function mergeItems(existing, runLog) {
  const byId = new Map(existing.map((item) => [item.id, { ...item }]));

  for (const result of runLog.results) {
    const status = VERDICT_TO_STATUS.get(result.verdict);
    const prior = byId.get(result.itemId);
    if (prior) {
      prior.status = status;
      if (result.verdict === "fail") {
        prior.retries += 1;
      }
      if (result.summary) {
        prior.summary = result.summary;
      }
      byId.set(result.itemId, prior);
    } else {
      const item = { id: result.itemId, status, retries: 0 };
      if (result.summary) {
        item.summary = result.summary;
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

function isNewUtcDay(lastRunAt, now) {
  if (!lastRunAt) {
    return false;
  }
  const last = new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) {
    return false;
  }
  return last.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}
