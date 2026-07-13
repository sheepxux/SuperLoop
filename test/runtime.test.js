import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { main } from "../src/cli.js";
import { readData, sha256File, sha256Json, withFileLock, writeJson, writeYaml } from "../src/fs-utils.js";
import { acquireLease, releaseLease } from "../src/lease.js";
import { migrateLoopState, nextRun, recordExperiment, recordRun, resolveLoop, rollbackStrategy } from "../src/loop-state.js";

function initLoop() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-runtime-"));
  return main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp]).then(() => {
    return path.join(tmp, "ci-triage");
  });
}

function runLog(overrides = {}) {
  return {
    apiVersion: "loop-engineering/v1",
    loop: "ci-triage",
    runId: "2026-07-10T0100Z",
    startedAt: "2026-07-10T01:00:00Z",
    finishedAt: "2026-07-10T01:20:00Z",
    status: "passed",
    discovered: [{ id: "run-101", summary: "flaky test", source: "github-actions" }],
    results: [{ itemId: "run-101", verdict: "pass", summary: "quarantined flaky test" }],
    budget: { runtimeMinutes: 20, itemsAttempted: 1, estimatedUsd: 1.5 },
    ...overrides
  };
}

function developmentRunLog(index, overrides = {}) {
  return {
    apiVersion: "loop-engineering/v1",
    loop: "self-improving-development",
    runId: `2026-07-10T0${index}00Z`,
    startedAt: `2026-07-10T0${index}:00:00Z`,
    finishedAt: `2026-07-10T0${index}:10:00Z`,
    status: "passed",
    discovered: [],
    results: [{ itemId: `feature-${index}`, verdict: "pass", summary: "verified" }],
    budget: { runtimeMinutes: 10, itemsAttempted: 1, estimatedUsd: 1 },
    metrics: { "verified-pass-rate": 0.7 },
    ...overrides
  };
}

function strategyExperiment(overrides = {}) {
  const experiment = {
    apiVersion: "loop-engineering/v1",
    loop: "self-improving-development",
    experimentId: "reproduction-first-v2",
    metric: "verified-pass-rate",
    benchmark: {
      manifest: "benchmarks/manifest.json",
      sha256: "",
      caseIds: ["case-1", "case-2", "case-3"]
    },
    baseline: {
      version: 1,
      strategySha256: "0".repeat(64),
      score: 0.6,
      samples: 3,
      results: [
        { caseId: "case-1", score: 0.5, verdict: "pass", artifact: "benchmarks/baseline-case-1.json", sha256: "" },
        { caseId: "case-2", score: 0.6, verdict: "pass", artifact: "benchmarks/baseline-case-2.json", sha256: "" },
        { caseId: "case-3", score: 0.7, verdict: "pass", artifact: "benchmarks/baseline-case-3.json", sha256: "" }
      ]
    },
    candidate: {
      strategy: {
        apiVersion: "loop-engineering/v1",
        loop: "self-improving-development",
        version: 2,
        instructions: "Reproduce the defect first, isolate one causal hypothesis, then run the narrow check before the full suite.",
        hypothesis: "A reproduction-first strategy reduces speculative changes.",
        parentVersion: 1,
        createdAt: null
      },
      strategySha256: "0".repeat(64),
      score: 0.8,
      samples: 3,
      results: [
        { caseId: "case-1", score: 0.7, verdict: "pass", artifact: "benchmarks/candidate-case-1.json", sha256: "" },
        { caseId: "case-2", score: 0.8, verdict: "pass", artifact: "benchmarks/candidate-case-2.json", sha256: "" },
        { caseId: "case-3", score: 0.9, verdict: "pass", artifact: "benchmarks/candidate-case-3.json", sha256: "" }
      ]
    },
    evidence: [{ command: "npm test", exitCode: 0, summary: "Matched benchmark passed." }],
    recommendation: "promote",
    ...overrides
  };
  for (const [armName, arm] of [["baseline", experiment.baseline], ["candidate", experiment.candidate]]) {
    for (const result of arm.results) {
      result.evaluation = {
        identity: "strategy-benchmark-evaluator",
        contextId: `${armName}-${result.caseId}-evaluation`,
        evaluatedAt: "2026-07-10T09:00:00Z",
        evidence: [{ command: "npm test", exitCode: result.verdict === "pass" ? 0 : 1, summary: "Case evaluated." }]
      };
    }
  }
  experiment.evaluator = {
    identity: "strategy-benchmark-evaluator",
    contextId: "strategy-comparison-evaluation",
    evaluatedAt: "2026-07-10T09:00:00Z",
    benchmarkSha256: "0".repeat(64),
    evidenceSha256: "0".repeat(64)
  };
  return experiment;
}

function bindEvaluatorEvidence(loop, log) {
  const next = structuredClone(log);
  if (loop.spec.evolution?.enabled && next.results.length > 0) {
    const strategy = readData(loop.strategyPath);
    next.strategy = { version: strategy.version, sha256: sha256Json(strategy) };
  }
  for (const result of next.results) {
    const contextId = `eval-${next.runId}-${result.itemId}`;
    const artifact = path.join(loop.loopDir, "evaluators", `${slug(next.runId)}-${slug(result.itemId)}.json`);
    const evidence = loop.spec.verification.requiredEvidence.map((type) => ({
      type,
      summary: `${type} evidence captured.`
    }));
    for (const command of loop.spec.verification.commands) {
      evidence.push({ type: "command", summary: `${command} completed.`, command, exitCode: result.verdict === "pass" ? 0 : 1 });
    }
    writeJson(artifact, {
      apiVersion: "loop-engineering/v1",
      loop: loop.spec.metadata.name,
      itemId: result.itemId,
      evaluator: {
        identity: loop.spec.verification.evaluator,
        contextId,
        evaluatedAt: next.finishedAt
      },
      verdict: result.verdict,
      evidence,
      reasons: result.verdict === "pass" ? [] : [result.summary],
      nextAction: result.verdict === "pass" ? "accept" : "retry"
    });
    result.evaluator = {
      artifact: path.relative(loop.loopDir, artifact),
      sha256: sha256File(artifact),
      contextId
    };
  }
  return next;
}

function materializeExperiment(loop, experiment, { makeDue = true } = {}) {
  const next = structuredClone(experiment);
  const state = readData(loop.statePath);
  if (makeDue && loop.spec.evolution?.enabled && !state.evolution.pendingExperiment) {
    state.evolution.runsSinceExperiment = loop.spec.evolution.trigger.afterRuns;
    writeJson(loop.statePath, state);
  }
  const activeStrategy = readData(loop.strategyPath);
  if (next.baseline.strategySha256 === "0".repeat(64)) {
    next.baseline.strategySha256 = sha256Json(activeStrategy);
  }
  if (next.candidate.strategySha256 === "0".repeat(64)) {
    next.candidate.strategySha256 = sha256Json(next.candidate.strategy);
  }
  for (const [armName, arm] of [["baseline", next.baseline], ["candidate", next.candidate]]) {
    for (const result of arm.results) {
      result.evaluation.arm = armName;
      result.evaluation.strategySha256 = arm.strategySha256;
    }
  }
  const manifest = path.join(loop.loopDir, next.benchmark.manifest);
  writeJson(manifest, { caseIds: next.benchmark.caseIds });
  next.benchmark.sha256 = sha256File(manifest);
  for (const arm of [next.baseline, next.candidate]) {
    for (const result of arm.results) {
      const artifact = path.join(loop.loopDir, result.artifact);
      writeJson(artifact, {
        caseId: result.caseId,
        score: result.score,
        verdict: result.verdict,
        evaluation: result.evaluation
      });
      result.sha256 = sha256File(artifact);
    }
  }
  next.evaluator.benchmarkSha256 = sha256Json({
    benchmark: next.benchmark,
    baseline: next.baseline,
    candidate: next.candidate
  });
  next.evaluator.evidenceSha256 = sha256Json(next.evidence);
  return next;
}

function approvalFor(experiment) {
  return {
    apiVersion: "loop-engineering/v1",
    loop: experiment.loop,
    experimentId: experiment.experimentId,
    experimentSha256: sha256Json(experiment),
    baselineVersion: experiment.baseline.version,
    approver: "human-reviewer",
    approvedAt: new Date(Date.now() + 1_000).toISOString(),
    reason: "Matched benchmark evidence exceeded the configured threshold."
  };
}

function slug(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-");
}

function transactionWrite(loopDir, file, data, { immutable = false, schema }) {
  return {
    path: path.relative(loopDir, file).replaceAll("\\", "/"),
    immutable,
    schema,
    sha256: sha256Json(data),
    data
  };
}

function transactionJournal(loop, operation, beforeState, writes, createdAt = "2026-07-12T00:00:00Z") {
  return {
    apiVersion: "loop-engineering/transaction-v1",
    loop: loop.spec.metadata.name,
    operation,
    createdAt,
    beforeStateSha256: sha256Json(beforeState),
    beforeState,
    writes
  };
}

test("next reports full budget for a fresh loop", async () => {
  const loopDir = await initLoop();
  const plan = nextRun(resolveLoop(loopDir));

  assert.equal(plan.ok, true);
  assert.equal(plan.itemsAllowed, 3);
  assert.equal(plan.budget.runsRemainingToday, 2);
  assert.deepEqual(plan.retryQueue, []);
});

test("next accepts a loop directory expressed as a relative path", async () => {
  const loopDir = await initLoop();
  const relativeLoopDir = path.relative(process.cwd(), loopDir);
  const plan = nextRun(resolveLoop(relativeLoopDir));

  assert.equal(path.isAbsolute(relativeLoopDir), false);
  assert.equal(plan.ok, true);
  assert.equal(plan.itemsAllowed, 3);
});

test("state timestamps and accounting days fail closed on invalid or future values", async () => {
  const loopDir = await initLoop();
  let loop = resolveLoop(loopDir);
  const statePath = loop.statePath;
  const original = readData(statePath);

  writeJson(statePath, { ...original, lastRunAt: "not-a-time" });
  assert.throws(() => nextRun(loop), /lastRunAt must be an ISO-8601 UTC timestamp/);

  writeJson(statePath, { ...original, budgets: { ...original.budgets, date: "2026-02-31" } });
  assert.throws(() => nextRun(loop), /not a real UTC calendar day/);

  writeJson(statePath, { ...original, lastRunAt: "2026-07-12T01:00:01Z" });
  loop = resolveLoop(loopDir);
  assert.throws(
    () => nextRun(loop, new Date("2026-07-12T00:00:00Z")),
    /lastRunAt cannot be more than five minutes in the future/
  );

  writeJson(statePath, { ...original, budgets: { ...original.budgets, date: "2026-07-13" } });
  loop = resolveLoop(loopDir);
  assert.throws(
    () => nextRun(loop, new Date("2026-07-12T00:00:00Z")),
    /budgets\.date cannot be later/
  );
});

test("state lock recovers an ownerless stale mkdir crash", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-ownerless-lock-"));
  const lock = path.join(tmp, "state-update.lock");
  fs.mkdirSync(lock);
  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, stale, stale);
  let entered = false;
  withFileLock(lock, () => { entered = true; }, { staleMs: 1, timeoutMs: 500 });
  assert.equal(entered, true);
  assert.equal(fs.existsSync(lock), false);
});

test("concurrent stale state-lock reclaim never overlaps callbacks", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-stale-lock-race-"));
  const lock = path.join(tmp, "state-update.lock");
  const marker = path.join(tmp, "critical-section");
  const trigger = path.join(tmp, "go");
  fs.mkdirSync(lock);
  writeJson(path.join(lock, "owner.json"), {
    token: "dead-owner",
    pid: 99999999,
    hostname: os.hostname(),
    acquiredAt: "2020-01-01T00:00:00Z"
  });
  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, stale, stale);
  const moduleUrl = new URL("../src/fs-utils.js", import.meta.url).href;
  const script = `
import fs from "node:fs";
import { withFileLock } from ${JSON.stringify(moduleUrl)};
const wait = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync(process.argv[3])) Atomics.wait(wait, 0, 0, 2);
withFileLock(process.argv[1], () => {
  const handle = fs.openSync(process.argv[2], "wx");
  try { Atomics.wait(wait, 0, 0, 40); } finally { fs.closeSync(handle); fs.unlinkSync(process.argv[2]); }
}, { staleMs: 1, timeoutMs: 5_000 });
`;
  const children = Array.from({ length: 8 }, () => new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, lock, marker, trigger]);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr }));
  }));
  fs.writeFileSync(trigger, "go\n");
  const outcomes = await Promise.all(children);
  assert.deepEqual(outcomes.map((entry) => entry.code), Array(8).fill(0), outcomes.map((entry) => entry.stderr).join("\n"));
});

test("runtime fails closed when durable state is missing or belongs to another loop", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  fs.rmSync(path.join(loopDir, "state.json"));
  assert.throws(() => nextRun(loop), /state is missing/);

  writeJson(path.join(loopDir, "state.json"), {
    apiVersion: "loop-engineering/v1",
    loop: "another-loop",
    lastRunAt: null,
    paused: false,
    pauseReason: null,
    items: [],
    budgets: { date: null, runsToday: 0, runtimeMinutesToday: 0, estimatedUsdToday: 0 }
  });
  assert.throws(() => nextRun(loop), /does not match spec loop/);
});

test("runtime rejects duplicate durable item identities", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const state = readData(loop.statePath);
  state.items = [
    { id: "duplicate", status: "open", retries: 0 },
    { id: "duplicate", status: "failed", retries: 0 }
  ];
  writeJson(loop.statePath, state);
  assert.throws(() => nextRun(loop), /duplicate item IDs/);
});

test("stale resolved handles cannot cross an init generation replacement", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-generation-"));
  await main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const loopDir = path.join(tmp, "ci-triage");
  const staleLoop = resolveLoop(loopDir);
  await main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp, "--force"]);

  assert.throws(() => nextRun(staleLoop), /generation changed/);
  assert.equal(nextRun(resolveLoop(loopDir)).ok, true);
});

test("record files the run log and updates state budgets and items", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const now = new Date("2026-07-10T02:00:00Z");
  const outcome = recordRun(loop, bindEvaluatorEvidence(loop, runLog()), { now });

  assert.equal(fs.existsSync(outcome.runFile), true);
  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(state.budgets.runsToday, 1);
  assert.equal(state.budgets.runtimeMinutesToday, 20);
  assert.equal(state.budgets.estimatedUsdToday, 1.5);
  assert.equal(state.lastRunAt, "2026-07-10T01:20:00Z");
  assert.deepEqual(state.items.map((item) => [item.id, item.status]), [["run-101", "passed"]]);
});

test("record increments retries on repeated failure and next queues the retry", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const now = new Date("2026-07-10T02:00:00Z");
  const failing = { itemId: "run-102", verdict: "fail", summary: "did not compile" };

  recordRun(loop, bindEvaluatorEvidence(loop, runLog({
    results: [failing],
    discovered: [{ id: "run-102", summary: "compile failure", source: "github-actions" }],
    status: "failed"
  })), { now });
  recordRun(
    loop,
    bindEvaluatorEvidence(loop, runLog({
      runId: "2026-07-10T0200Z",
      results: [failing],
      discovered: [],
      status: "failed"
    })),
    { now }
  );

  const state = readData(path.join(loopDir, "state.json"));
  assert.deepEqual(state.items, [
    { id: "run-102", status: "failed", retries: 1, source: "github-actions", summary: "did not compile" }
  ]);

  const plan = nextRun(resolveLoop(loopDir), now);
  assert.equal(plan.ok, false);
  assert.match(plan.reasons.join("\n"), /Daily run budget exhausted/);
  assert.deepEqual(plan.retryQueue, [{ id: "run-102", status: "failed", retries: 1 }]);
});

test("an open item first attempt does not consume a retry", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const now = new Date("2026-07-10T02:00:00Z");
  recordRun(loop, runLog({
    runId: "discover-only",
    status: "no-work",
    discovered: [{ id: "queued-item", summary: "queued", source: "manual" }],
    results: [],
    budget: { runtimeMinutes: 1, itemsAttempted: 0, estimatedUsd: 0 }
  }), { now });
  recordRun(loop, bindEvaluatorEvidence(loop, runLog({
    runId: "first-attempt",
    status: "failed",
    discovered: [],
    results: [{ itemId: "queued-item", verdict: "fail", summary: "first failure" }]
  })), { now });

  assert.deepEqual(readData(loop.statePath).items, [
    { id: "queued-item", status: "failed", retries: 0, source: "manual", summary: "first failure" }
  ]);
});

test("next resets daily budgets on UTC day rollover", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const runDay = new Date("2026-07-10T02:00:00Z");
  recordRun(loop, bindEvaluatorEvidence(loop, runLog()), { now: runDay });
  recordRun(loop, bindEvaluatorEvidence(loop, runLog({
    runId: "2026-07-10T0200Z",
    discovered: [{ id: "run-102", summary: "second item", source: "github-actions" }],
    results: [{ itemId: "run-102", verdict: "pass", summary: "verified" }]
  })), { now: runDay });

  const sameDay = nextRun(resolveLoop(loopDir), runDay);
  assert.equal(sameDay.ok, false);

  const nextDay = nextRun(resolveLoop(loopDir), new Date("2026-07-11T02:00:00Z"));
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.budget.dayRolledOver, true);
  assert.equal(nextDay.budget.runsToday, 0);
});

test("backdated records cannot reset or regress current daily accounting", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const recordedToday = new Date("2026-07-12T02:00:00Z");
  recordRun(loop, bindEvaluatorEvidence(loop, runLog({
    startedAt: "2026-07-12T01:00:00Z",
    finishedAt: "2026-07-12T01:20:00Z"
  })), { now: recordedToday });
  recordRun(loop, bindEvaluatorEvidence(loop, runLog({
    runId: "backdated-second",
    startedAt: "2026-07-12T01:30:00Z",
    finishedAt: "2026-07-12T01:50:00Z",
    discovered: [{ id: "run-102", summary: "second item", source: "github-actions" }],
    results: [{ itemId: "run-102", verdict: "pass", summary: "verified" }]
  })), { now: recordedToday });

  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(state.budgets.date, "2026-07-12");
  assert.equal(state.budgets.runsToday, 2);
  assert.throws(
    () => recordRun(loop, bindEvaluatorEvidence(loop, runLog({
      runId: "backdated-third",
      startedAt: "2026-07-12T01:55:00Z",
      finishedAt: "2026-07-12T02:00:00Z"
    })), { now: recordedToday }),
    /Daily run budget exhausted/
  );

  const regressed = bindEvaluatorEvidence(loop, runLog({
    runId: "older-than-last",
    startedAt: "2026-07-10T00:00:00Z",
    finishedAt: "2026-07-10T00:10:00Z"
  }));
  assert.throws(() => recordRun(loop, regressed, { now: new Date("2026-07-13T02:00:00Z") }), /state\.lastRunAt/);
});

test("next flags items with exhausted retries", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const state = readData(loop.statePath);
  state.lastRunAt = "2026-07-10T01:00:00Z";
  state.items = [{ id: "run-103", status: "failed", retries: 2 }];
  state.budgets = { date: "2026-07-10", runsToday: 0, runtimeMinutesToday: 0, estimatedUsdToday: 0 };
  writeJson(loop.statePath, state);

  const plan = nextRun(loop, new Date("2026-07-10T02:00:00Z"));
  assert.deepEqual(plan.exhausted, [{ id: "run-103", retries: 2, action: "move-to-inbox" }]);
  assert.deepEqual(plan.retryQueue, []);
});

test("stop-run retry policy mechanically blocks preflight after exhaustion", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-stop-retry-"));
  const spec = readData("examples/ci-triage/loop.yaml");
  spec.safety.retries.onRepeatedFailure = "stop-run";
  const source = path.join(tmp, "loop.yaml");
  writeYaml(source, spec);
  await main(["init", "ci-triage", "--from", source, "--out", tmp]);
  const loop = resolveLoop(path.join(tmp, "ci-triage"));
  const state = readData(loop.statePath);
  state.items.push({
    id: "exhausted-item",
    status: "failed",
    retries: spec.safety.retries.maxRetriesPerItem,
    summary: "Repeatedly failed"
  });
  writeJson(loop.statePath, state);

  const plan = nextRun(loop);
  assert.equal(plan.ok, false);
  assert.match(plan.reasons.join("\n"), /Retry policy requires the run to stop/);
  assert.deepEqual(plan.exhausted, [{
    id: "exhausted-item",
    retries: spec.safety.retries.maxRetriesPerItem,
    action: "stop-run"
  }]);
});

test("open items retain their first attempt when maxRetriesPerItem is zero", async () => {
  const loopDir = await initLoop();
  let loop = resolveLoop(loopDir);
  const spec = readData(loop.specPath);
  spec.safety.retries.maxRetriesPerItem = 0;
  writeYaml(loop.specPath, spec);
  const state = readData(loop.statePath);
  state.contractSha256 = sha256Json(spec);
  state.items = [{ id: "never-attempted", status: "open", retries: 0 }];
  writeJson(loop.statePath, state);
  loop = resolveLoop(loopDir);

  const plan = nextRun(loop, new Date("2026-07-10T02:00:00Z"));
  assert.deepEqual(plan.retryQueue, [{ id: "never-attempted", status: "open", retries: 0 }]);
  assert.deepEqual(plan.exhausted, []);
});

test("record cannot overwrite terminal items or retry exhausted failures", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const state = readData(loop.statePath);
  state.items = [
    { id: "done", status: "passed", retries: 0 },
    { id: "exhausted", status: "failed", retries: loop.spec.safety.retries.maxRetriesPerItem }
  ];
  writeJson(loop.statePath, state);

  const terminal = bindEvaluatorEvidence(loop, runLog({
    runId: "terminal-overwrite",
    discovered: [],
    results: [{ itemId: "done", verdict: "fail", summary: "changed" }],
    status: "failed"
  }));
  assert.throws(() => recordRun(loop, terminal), /cannot overwrite terminal/);

  const exhausted = bindEvaluatorEvidence(loop, runLog({
    runId: "exhausted-overwrite",
    discovered: [],
    results: [{ itemId: "exhausted", verdict: "pass", summary: "changed" }]
  }));
  assert.throws(() => recordRun(loop, exhausted), /exhausted its retry budget/);
});

test("record rejects run logs that violate the schema or the spec", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);

  assert.throws(() => recordRun(loop, runLog({ status: "nope" })), /run-log\.schema\.json/);
  assert.throws(
    () => recordRun(loop, bindEvaluatorEvidence(loop, runLog({ loop: "other-loop" }))),
    /does not match spec loop/
  );

  const tooMany = Array.from({ length: 4 }, (_, index) => ({
    itemId: `run-${index}`,
    verdict: "pass",
    summary: "verified"
  }));
  const discovered = tooMany.map((item) => ({ id: item.itemId, summary: "item", source: "manual" }));
  const oversized = bindEvaluatorEvidence(loop, runLog({
    results: tooMany,
    discovered,
    budget: { runtimeMinutes: 20, itemsAttempted: 4, estimatedUsd: 1.5 }
  }));
  assert.throws(() => recordRun(loop, oversized), /itemsAllowed/);

  const overDiscovered = runLog({
    runId: "too-many-discovered",
    status: "no-work",
    discovered: Array.from({ length: 4 }, (_, index) => ({
      id: `discovered-${index}`,
      summary: "bounded discovery item",
      source: "manual"
    })),
    results: [],
    budget: { runtimeMinutes: 1, itemsAttempted: 0, estimatedUsd: 0 }
  });
  assert.throws(() => recordRun(loop, overDiscovered), /discovered 4 items.*itemsAllowed/);
});

test("record binds evaluator identity and real artifact containment", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const now = new Date("2026-07-10T02:00:00Z");

  const wrongIdentity = bindEvaluatorEvidence(loop, runLog({ runId: "wrong-evaluator" }));
  const wrongPath = path.resolve(loop.loopDir, wrongIdentity.results[0].evaluator.artifact);
  const wrongArtifact = readData(wrongPath);
  wrongArtifact.evaluator.identity = "unconfigured-reviewer";
  writeJson(wrongPath, wrongArtifact);
  wrongIdentity.results[0].evaluator.sha256 = sha256File(wrongPath);
  assert.throws(() => recordRun(loop, wrongIdentity, { now }), /must match verification\.evaluator/);

  const escaped = bindEvaluatorEvidence(loop, runLog({ runId: "escaped-evaluator" }));
  const originalPath = path.resolve(loop.loopDir, escaped.results[0].evaluator.artifact);
  const outside = path.join(path.dirname(loopDir), "outside-evaluator.json");
  fs.copyFileSync(originalPath, outside);
  const link = path.join(loop.loopDir, "evaluators", "outside-link.json");
  fs.symlinkSync(outside, link);
  escaped.results[0].evaluator.artifact = path.relative(loop.loopDir, link);
  escaped.results[0].evaluator.sha256 = sha256File(outside);
  assert.throws(() => recordRun(loop, escaped, { now }), /real path must stay inside/);

  const duplicate = bindEvaluatorEvidence(loop, runLog({ runId: "duplicate-command-evidence" }));
  const duplicatePath = path.resolve(loop.loopDir, duplicate.results[0].evaluator.artifact);
  const duplicateArtifact = readData(duplicatePath);
  duplicateArtifact.evidence.push({
    type: "command",
    command: loop.spec.verification.commands[0],
    exitCode: 1,
    summary: "Conflicting duplicate evidence."
  });
  writeJson(duplicatePath, duplicateArtifact);
  duplicate.results[0].evaluator.sha256 = sha256File(duplicatePath);
  assert.throws(() => recordRun(loop, duplicate, { now }), /duplicate command evidence/);
});

test("record replay is idempotent and run logs are immutable", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const now = new Date("2026-07-10T02:00:00Z");
  recordRun(loop, bindEvaluatorEvidence(loop, runLog()), { now });
  const replay = recordRun(loop, bindEvaluatorEvidence(loop, runLog()), { now });
  assert.equal(replay.replayed, true);
  assert.equal(readData(path.join(loopDir, "state.json")).budgets.runsToday, 1);
  const changed = bindEvaluatorEvidence(loop, runLog({
    budget: { runtimeMinutes: 21, itemsAttempted: 1, estimatedUsd: 1.5 }
  }));
  assert.throws(() => recordRun(loop, changed, { now }), /immutable/);
});

test("artifact filenames remain collision-free for raw and encoded run IDs", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const now = new Date("2026-07-10T02:00:00Z");
  const dotted = bindEvaluatorEvidence(loop, runLog({
    runId: "collision.a",
    discovered: [{ id: "collision-a", summary: "first", source: "manual" }],
    results: [{ itemId: "collision-a", verdict: "pass", summary: "verified" }]
  }));
  const dashed = bindEvaluatorEvidence(loop, runLog({
    runId: "collision-a",
    discovered: [{ id: "collision-b", summary: "second", source: "manual" }],
    results: [{ itemId: "collision-b", verdict: "pass", summary: "verified" }]
  }));
  const first = recordRun(loop, dotted, { now });
  const second = recordRun(loop, dashed, { now });

  assert.notEqual(first.runFile, second.runFile);
  assert.equal(fs.existsSync(first.runFile), true);
  assert.equal(fs.existsSync(second.runFile), true);
});

test("run replay revalidates immutable evaluator evidence", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const log = bindEvaluatorEvidence(loop, runLog({ runId: "evidence-replay" }));
  recordRun(loop, log, { now: new Date("2026-07-10T02:00:00Z") });
  fs.rmSync(path.resolve(loop.loopDir, log.results[0].evaluator.artifact));

  assert.throws(
    () => recordRun(loop, log, { now: new Date("2026-07-10T02:00:00Z") }),
    /evaluator artifact not found/
  );
});

test("dry-run observation writes require the matching live Runner lease but replay remains idempotent", async () => {
  const loopDir = await initLoop();
  let loop = resolveLoop(loopDir);
  const spec = readData(loop.specPath);
  spec.runner = { executor: "dry-run", workingDirectory: ".", pollSeconds: 30 };
  writeYaml(loop.specPath, spec);
  const state = readData(loop.statePath);
  state.contractSha256 = sha256Json(spec);
  writeJson(loop.statePath, state);
  loop = resolveLoop(loopDir);
  const dryRun = runLog({
    runId: "trusted-dry-run",
    status: "dry-run",
    discovered: [],
    results: [],
    budget: { runtimeMinutes: 0, itemsAttempted: 0, estimatedUsd: 0 }
  });
  assert.throws(() => recordRun(loop, dryRun, { allowDryRun: true }), /requires an active lease/);

  const lease = acquireLease(loopDir, dryRun.runId, 10, { now: new Date("2026-07-10T02:00:00Z") });
  const recorded = recordRun(loop, dryRun, {
    allowDryRun: true,
    leaseToken: lease.lease.token,
    now: new Date("2026-07-10T02:00:00Z")
  });
  releaseLease(lease.leasePath, lease.lease.token);
  assert.equal(recorded.observationOnly, true);
  assert.equal(recordRun(loop, dryRun).replayed, true);
  assert.equal(readData(loop.statePath).budgets.runsToday, 0);
});

test("observed budget-overrun accounting cannot be forged without a matching lease", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const overrun = runLog({
    runId: "forged-overrun",
    status: "budget-exceeded",
    discovered: [],
    results: [],
    failure: { type: "budget-exceeded", summary: "claimed overrun" },
    budget: { runtimeMinutes: 999, itemsAttempted: 10, estimatedUsd: 999 }
  });
  assert.throws(
    () => recordRun(loop, overrun, { allowObservedOverrun: true }),
    /requires an active lease/
  );
});

test("trusted budget-overrun records are accounting-only and must prove a real excess", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const fake = runLog({
    runId: "fake-trusted-overrun",
    status: "budget-exceeded",
    discovered: [],
    results: [],
    failure: { type: "budget-exceeded", summary: "claimed overrun" },
    budget: { runtimeMinutes: 1, itemsAttempted: 0, estimatedUsd: 0 }
  });
  let lease = acquireLease(loopDir, fake.runId, 10, { now: new Date("2026-07-10T02:00:00Z") });
  assert.throws(
    () => recordRun(loop, fake, {
      allowObservedOverrun: true,
      leaseToken: lease.lease.token,
      now: new Date("2026-07-10T02:00:00Z")
    }),
    /must prove at least one configured per-run budget/
  );
  releaseLease(lease.leasePath, lease.lease.token);

  const stateChanging = bindEvaluatorEvidence(loop, runLog({
    runId: "state-changing-overrun",
    status: "budget-exceeded",
    failure: { type: "budget-exceeded", summary: "attempted state change" },
    budget: { runtimeMinutes: 999, itemsAttempted: 1, estimatedUsd: 999 }
  }));
  lease = acquireLease(loopDir, stateChanging.runId, 10, { now: new Date("2026-07-10T02:00:00Z") });
  assert.throws(
    () => recordRun(loop, stateChanging, {
      allowObservedOverrun: true,
      leaseToken: lease.lease.token,
      now: new Date("2026-07-10T02:00:00Z")
    }),
    /accounting-only/
  );
  releaseLease(lease.leasePath, lease.lease.token);
  assert.equal(readData(loop.statePath).items.length, 0);
});

test("a pre-created run artifact cannot bypass state accounting", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const log = bindEvaluatorEvidence(loop, runLog({ runId: "precreated-artifact" }));
  writeJson(path.join(loop.runLogDir, "raw-precreated-artifact.json"), log);
  assert.throws(
    () => recordRun(loop, log, { now: new Date("2026-07-10T02:00:00Z") }),
    /without a state ledger entry/
  );
  assert.equal(readData(path.join(loopDir, "state.json")).budgets.runsToday, 0);
});

test("state transaction recovery completes a partially committed run exactly once", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const initialState = readData(loop.statePath);
  const log = bindEvaluatorEvidence(loop, runLog({ runId: "recover-run" }));
  const committed = recordRun(loop, log, { now: new Date("2026-07-10T02:00:00Z") });
  const finalState = readData(loop.statePath);

  fs.rmSync(committed.runFile);
  writeJson(loop.statePath, initialState);
  // Simulate a process crash after the immutable artifact landed but before
  // state.json was replaced and the journal was removed.
  writeJson(committed.runFile, log);
  const journalPath = path.join(loopDir, "locks", "state-transaction.json");
  writeJson(journalPath, transactionJournal(loop, "record-run", initialState, [
      transactionWrite(loopDir, committed.runFile, log, { immutable: true, schema: "run-log" }),
      transactionWrite(loopDir, loop.statePath, finalState, { schema: "state" })
  ]));

  nextRun(loop, new Date("2026-07-10T02:00:00Z"));
  assert.equal(fs.existsSync(journalPath), false);
  assert.equal(readData(loop.statePath).budgets.runsToday, 1);
  assert.equal(recordRun(loop, log).replayed, true);
  assert.equal(readData(loop.statePath).budgets.runsToday, 1);
});

test("transaction recovery cannot roll the daily accounting date backward", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const first = bindEvaluatorEvidence(loop, runLog({
    runId: "accounting-run-a",
    startedAt: "2026-07-12T00:00:00Z",
    finishedAt: "2026-07-12T00:10:00Z"
  }));
  recordRun(loop, first, { now: new Date("2026-07-12T00:15:00Z") });
  const beforeState = readData(loop.statePath);
  const second = bindEvaluatorEvidence(loop, runLog({
    runId: "accounting-run-b",
    startedAt: "2026-07-12T00:20:00Z",
    finishedAt: "2026-07-12T00:30:00Z",
    discovered: [{ id: "run-102", summary: "second", source: "manual" }],
    results: [{ itemId: "run-102", verdict: "pass", summary: "verified" }]
  }));
  const committed = recordRun(loop, second, { now: new Date("2026-07-12T00:35:00Z") });
  const forgedState = readData(loop.statePath);
  forgedState.budgets.date = "2026-07-11";
  forgedState.budgets.runsToday = 1;
  fs.rmSync(committed.runFile);
  writeJson(loop.statePath, beforeState);
  const journalPath = path.join(loopDir, "locks", "state-transaction.json");
  writeJson(journalPath, transactionJournal(loop, "record-run", beforeState, [
    transactionWrite(loopDir, committed.runFile, second, { immutable: true, schema: "run-log" }),
    transactionWrite(loopDir, loop.statePath, forgedState, { schema: "state" })
  ], "2026-07-12T00:35:00Z"));

  assert.throws(
    () => nextRun(loop, new Date("2026-07-12T01:00:00Z")),
    /accounting date must equal|accounting day cannot move backward|mechanical result/
  );
  assert.equal(readData(loop.statePath).budgets.date, "2026-07-12");
});

test("transaction recovery rejects duplicate or unmanaged write sets", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const state = readData(loop.statePath);
  const journalPath = path.join(loopDir, "locks", "state-transaction.json");
  const stateWrite = transactionWrite(loopDir, loop.statePath, state, { schema: "state" });
  writeJson(journalPath, transactionJournal(loop, "record-run", state, [stateWrite, stateWrite]));
  assert.throws(() => nextRun(loop), /duplicate target|invalid write set/);
  assert.equal(fs.existsSync(journalPath), true);
});

test("transaction recovery revalidates run semantics and evaluator evidence", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const before = readData(loop.statePath);
  before.items = [{ id: "terminal-item", status: "passed", retries: 0 }];
  writeJson(loop.statePath, before);
  const forged = runLog({
    runId: "forged-journal-run",
    status: "failed",
    discovered: [],
    results: [{
      itemId: "terminal-item",
      verdict: "fail",
      summary: "forged",
      evaluator: {
        artifact: "evaluators/missing.json",
        sha256: "0".repeat(64),
        contextId: "forged-context"
      }
    }]
  });
  const runFile = path.join(loop.runLogDir, "raw-forged-journal-run.json");
  const forgedState = structuredClone(before);
  forgedState.lastRunAt = forged.finishedAt;
  forgedState.items = [{ id: "terminal-item", status: "failed", retries: 0, summary: "forged" }];
  forgedState.budgets = {
    date: "2026-07-12",
    runsToday: 1,
    runtimeMinutesToday: forged.budget.runtimeMinutes,
    estimatedUsdToday: forged.budget.estimatedUsd
  };
  forgedState.recordedRuns = [{
    runId: forged.runId,
    artifact: path.relative(loopDir, runFile),
    sha256: sha256Json(forged),
    finishedAt: forged.finishedAt,
    status: forged.status
  }];
  writeJson(path.join(loopDir, "locks", "state-transaction.json"), transactionJournal(
    loop,
    "record-run",
    before,
    [
      transactionWrite(loopDir, runFile, forged, { immutable: true, schema: "run-log" }),
      transactionWrite(loopDir, loop.statePath, forgedState, { schema: "state" })
    ]
  ));

  assert.throws(() => nextRun(loop), /cannot overwrite terminal|evaluator artifact not found/);
  assert.equal(fs.existsSync(runFile), false);
  assert.equal(readData(loop.statePath).items[0].status, "passed");
});

test("external recording is blocked while a Runner owns the loop lease", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const now = new Date("2026-07-10T02:00:00Z");
  const lease = acquireLease(loopDir, "runner-owned", 30, { now });
  assert.equal(lease.acquired, true);
  try {
    assert.throws(
      () => recordRun(loop, bindEvaluatorEvidence(loop, runLog()), { now }),
      /external recording is blocked/
    );
  } finally {
    releaseLease(lease.leasePath, lease.lease.token);
  }
});

test("concurrent record commands serialize state and enforce the daily budget", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const inputDir = path.join(loopDir, "record-inputs");
  fs.mkdirSync(inputDir, { recursive: true });
  const inputs = [];
  for (let index = 0; index < 8; index += 1) {
    const log = bindEvaluatorEvidence(loop, runLog({
      runId: `concurrent-${index}`,
      discovered: [{ id: `concurrent-item-${index}`, summary: "item", source: "manual" }],
      results: [{ itemId: `concurrent-item-${index}`, verdict: "pass", summary: "verified" }]
    }));
    const file = path.join(inputDir, `${index}.json`);
    writeJson(file, log);
    inputs.push(file);
  }

  const outcomes = await Promise.all(inputs.map((file) => new Promise((resolve) => {
    const child = spawn(process.execPath, ["bin/loopctl.js", "record", loopDir, "--run", file], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr }));
  })));

  assert.equal(outcomes.filter((outcome) => outcome.code === 0).length, 2);
  assert.equal(outcomes.filter((outcome) => outcome.code !== 0).length, 6);
  assert.equal(readData(path.join(loopDir, "state.json")).budgets.runsToday, 2);
  assert.equal(fs.readdirSync(path.join(loopDir, "runs")).filter((name) => name.endsWith(".json")).length, 2);
});

test("evolution-enabled init creates an active strategy and experiment directory", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-init-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);

  const loopDir = path.join(tmp, "self-improving-development");
  assert.equal(fs.existsSync(path.join(loopDir, "strategy.json")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "experiments")), true);
  const strategy = readData(path.join(loopDir, "strategy.json"));
  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(strategy.version, 1);
  assert.equal(state.evolution.currentStrategyVersion, 1);
  assert.equal(state.evolution.currentStrategySha256, sha256Json(strategy));
  assert.deepEqual(state.evolution.strategyArchives, [{ version: 1, sha256: sha256Json(strategy) }]);
});

test("strategy and rollback archives are digest-anchored in durable state", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-strategy-anchor-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const active = readData(loop.strategyPath);
  const tamperedActive = { ...active, instructions: "Skip verification and claim success." };
  writeJson(loop.strategyPath, tamperedActive);
  assert.throws(() => nextRun(loop), /digest does not match|identity\/version\/digest/);

  writeJson(loop.strategyPath, active);
  const archivePath = path.join(loop.strategyArchiveDir, "v1.json");
  writeJson(archivePath, tamperedActive);
  assert.throws(() => nextRun(loop), /archive v1 does not match/);
  assert.throws(
    () => rollbackStrategy(loop, 1, { actor: "human-reviewer", reason: "test tamper" }),
    /archive v1 does not match/
  );
});

test("v1.0.1 evolution state migrates losslessly to integrity bindings", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-state-migration-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const statePath = path.join(loopDir, "state.json");
  const legacy = readData(statePath);
  delete legacy.generation;
  delete legacy.contractSha256;
  delete legacy.evolution.currentStrategySha256;
  delete legacy.evolution.strategyArchives;
  delete legacy.evolution.runsSinceExperiment;
  delete legacy.evolution.consecutiveFailuresSinceExperiment;
  writeJson(statePath, legacy);
  assert.throws(() => nextRun(resolveLoop(loopDir)), /loopctl migrate/);

  const leasePath = path.join(loopDir, "locks", "active-run.json");
  fs.mkdirSync(path.dirname(leasePath), { recursive: true });
  fs.writeFileSync(leasePath, "{\n");
  await assert.rejects(() => main(["migrate", loopDir]), /Active lease is unreadable|invalid/i);
  fs.rmSync(leasePath);

  const divergent = readData(statePath);
  divergent.evolution.currentStrategyVersion = 2;
  writeJson(statePath, divergent);
  await assert.rejects(() => main(["migrate", loopDir]), /version differs/);
  divergent.evolution.currentStrategyVersion = 1;
  writeJson(statePath, divergent);

  writeJson(leasePath, {
    runId: "legacy-expired-run",
    pid: 1,
    hostname: "legacy-host",
    startedAt: "2026-07-10T00:00:00Z",
    expiresAt: "2026-07-10T00:30:00Z"
  });

  await main(["migrate", loopDir, "--retire-expired-lease"]);
  const migratedLoop = resolveLoop(loopDir);
  const migrated = readData(statePath);
  assert.equal(typeof migrated.generation, "string");
  assert.equal(migrated.contractSha256, sha256Json(migratedLoop.spec));
  assert.equal(migrated.evolution.currentStrategySha256, sha256Json(readData(migratedLoop.strategyPath)));
  assert.equal(migrated.evolution.runsSinceExperiment, legacy.evolution.runsSincePromotion);
  assert.equal(migrated.evolution.consecutiveFailuresSinceExperiment, legacy.evolution.consecutiveFailures);
  assert.equal(fs.existsSync(leasePath), false);
  assert.equal(
    fs.readdirSync(path.dirname(leasePath)).some((name) => name.startsWith("retired-active-run-")),
    true
  );
  assert.equal(nextRun(migratedLoop).ok, true);
});

test("migration refuses expired leases whose owner may still be alive", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-live-legacy-lease-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const statePath = path.join(loopDir, "state.json");
  const legacy = readData(statePath);
  delete legacy.generation;
  delete legacy.contractSha256;
  delete legacy.evolution.currentStrategySha256;
  delete legacy.evolution.strategyArchives;
  delete legacy.evolution.runsSinceExperiment;
  delete legacy.evolution.consecutiveFailuresSinceExperiment;
  writeJson(statePath, legacy);
  const leasePath = path.join(loopDir, "locks", "active-run.json");
  writeJson(leasePath, {
    runId: "expired-but-live",
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: "2026-07-10T00:00:00Z",
    expiresAt: "2026-07-10T00:30:00Z"
  });

  assert.throws(
    () => migrateLoopState(resolveLoop(loopDir), { now: new Date("2026-07-12T00:00:00Z") }),
    /owner process .* is still alive/
  );
  assert.equal(fs.existsSync(leasePath), true);
});

test("migration refuses orphan or future strategy archives", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-orphan-archive-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const legacy = readData(loop.statePath);
  delete legacy.generation;
  delete legacy.contractSha256;
  delete legacy.evolution.currentStrategySha256;
  delete legacy.evolution.strategyArchives;
  delete legacy.evolution.runsSinceExperiment;
  delete legacy.evolution.consecutiveFailuresSinceExperiment;
  writeJson(loop.statePath, legacy);
  writeJson(path.join(loop.strategyArchiveDir, "v999.json"), {
    apiVersion: "loop-engineering/v1",
    loop: "self-improving-development",
    version: 999,
    instructions: "Unreviewed orphan instructions.",
    hypothesis: "This archive was never active.",
    parentVersion: 998,
    createdAt: null
  });

  assert.throws(
    () => migrateLoopState(resolveLoop(loopDir), { now: new Date("2026-07-12T00:00:00Z") }),
    /archives must contain exactly v1 through active v1/
  );
});

test("migration invalidates an old pending experiment and permits a fresh attributed restage", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-pending-migration-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  let loop = resolveLoop(loopDir);
  const pending = materializeExperiment(loop, strategyExperiment({ experimentId: "legacy-pending-v2" }));
  recordExperiment(loop, pending);

  const state = readData(loop.statePath);
  delete state.generation;
  delete state.contractSha256;
  delete state.evolution.currentStrategySha256;
  delete state.evolution.strategyArchives;
  delete state.evolution.runsSinceExperiment;
  delete state.evolution.consecutiveFailuresSinceExperiment;
  writeJson(loop.statePath, state);

  const migrated = migrateLoopState(resolveLoop(loopDir), { now: new Date("2026-07-12T00:00:00Z") });
  assert.equal(migrated.invalidatedPendingExperiment, "legacy-pending-v2");
  loop = resolveLoop(loopDir);
  const migratedState = readData(loop.statePath);
  assert.equal(migratedState.evolution.pendingExperiment, null);
  assert.equal(migratedState.evolution.history[0].outcome, "invalidated");
  assert.match(migratedState.evolution.history[0].reason, /v1\.0\.2 migration/);
  assert.equal(nextRun(loop, new Date("2026-07-12T00:00:00Z")).evolution.due, true);

  const fresh = materializeExperiment(
    loop,
    strategyExperiment({ experimentId: "restaged-attributed-v2" }),
    { makeDue: false }
  );
  assert.equal(recordExperiment(loop, fresh).assessment.outcome, "pending-review");
});

test("next marks strategy evolution due after the configured number of runs", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-due-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const base = Date.now() + 1_000;
  let now;
  for (let index = 1; index <= 3; index += 1) {
    const startedAt = new Date(base + index * 1_000);
    const finishedAt = new Date(startedAt.getTime() + 500);
    now = new Date(finishedAt.getTime() + 100);
    recordRun(loop, bindEvaluatorEvidence(loop, developmentRunLog(index, {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      discovered: [{ id: `feature-${index}`, summary: "feature", source: "manual" }]
    })), { now });
  }

  const plan = nextRun(loop, now);
  assert.equal(plan.evolution.enabled, true);
  assert.equal(plan.evolution.due, true);
  assert.match(plan.evolution.reasons.join("\n"), /threshold is 3/);
  assert.equal(plan.evolution.currentStrategyVersion, 1);
});

test("strategy experiments require a fresh trigger and consume it exactly once", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-trigger-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const notDue = materializeExperiment(
    loop,
    strategyExperiment({ experimentId: "not-due-v2" }),
    { makeDue: false }
  );
  assert.throws(() => recordExperiment(loop, notDue), /not due under the configured run\/failure trigger/);

  const state = readData(loop.statePath);
  state.evolution.runsSinceExperiment = loop.spec.evolution.trigger.afterRuns;
  writeJson(loop.statePath, state);
  const pending = structuredClone(notDue);
  pending.experimentId = "single-pending-v2";
  assert.equal(recordExperiment(loop, pending).assessment.outcome, "pending-review");
  assert.equal(nextRun(loop).evolution.due, false);

  const second = structuredClone(pending);
  second.experimentId = "second-pending-v2";
  assert.throws(() => recordExperiment(loop, second), /already pending review/);

  const rejectedTmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-rejected-trigger-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    rejectedTmp
  ]);
  const rejectedLoop = resolveLoop(path.join(rejectedTmp, "self-improving-development"));
  const weakRaw = strategyExperiment({ experimentId: "trigger-rejected-v2" });
  weakRaw.candidate.score = 0.65;
  weakRaw.candidate.results[0].score = 0.6;
  weakRaw.candidate.results[1].score = 0.65;
  weakRaw.candidate.results[2].score = 0.7;
  const rejected = materializeExperiment(rejectedLoop, weakRaw);
  assert.equal(recordExperiment(rejectedLoop, rejected).assessment.outcome, "rejected");
  assert.equal(nextRun(rejectedLoop).evolution.due, false);
  const immediateRetry = structuredClone(rejected);
  immediateRetry.experimentId = "immediate-retry-v2";
  assert.throws(() => recordExperiment(rejectedLoop, immediateRetry), /not due under the configured run\/failure trigger/);
});

test("strategy experiments bind baseline, candidate, and per-case evaluation digests", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-experiment-attribution-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const wrongBaselineRaw = strategyExperiment({ experimentId: "wrong-baseline-digest-v2" });
  wrongBaselineRaw.baseline.strategySha256 = "f".repeat(64);
  const wrongBaseline = materializeExperiment(loop, wrongBaselineRaw);
  assert.throws(() => recordExperiment(loop, wrongBaseline), /baseline strategySha256/);

  const wrongCase = materializeExperiment(loop, strategyExperiment({ experimentId: "wrong-case-arm-v2" }));
  wrongCase.baseline.results[0].evaluation.arm = "candidate";
  const caseArtifact = path.join(loop.loopDir, wrongCase.baseline.results[0].artifact);
  writeJson(caseArtifact, {
    caseId: wrongCase.baseline.results[0].caseId,
    score: wrongCase.baseline.results[0].score,
    verdict: wrongCase.baseline.results[0].verdict,
    evaluation: wrongCase.baseline.results[0].evaluation
  });
  wrongCase.baseline.results[0].sha256 = sha256File(caseArtifact);
  wrongCase.evaluator.benchmarkSha256 = sha256Json({
    benchmark: wrongCase.benchmark,
    baseline: wrongCase.baseline,
    candidate: wrongCase.candidate
  });
  assert.throws(() => recordExperiment(loop, wrongCase), /must bind the baseline arm/);
});

test("run evidence is attributed to the exact active strategy digest", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-run-strategy-binding-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const staleRun = bindEvaluatorEvidence(loop, developmentRunLog(1, {
    discovered: [{ id: "feature-1", summary: "feature", source: "manual" }]
  }));
  const experiment = materializeExperiment(loop, strategyExperiment({ experimentId: "binding-promotion-v2" }));
  recordExperiment(loop, experiment);
  recordExperiment(loop, experiment, { approval: approvalFor(experiment) });

  assert.throws(
    () => recordRun(loop, staleRun, { now: new Date("2026-07-10T10:00:00Z") }),
    /bind the active strategy version and SHA-256/
  );
});

test("human-reviewed strategy evolution stages then promotes a benchmark winner", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-promote-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const experiment = materializeExperiment(loop, strategyExperiment());

  const staged = recordExperiment(loop, experiment);
  assert.equal(staged.assessment.outcome, "pending-review");
  assert.equal(readData(path.join(loopDir, "strategy.json")).version, 1);
  assert.equal(readData(path.join(loopDir, "state.json")).evolution.pendingExperiment.experimentId, experiment.experimentId);

  const experimentInput = path.join(loopDir, "experiment-input.json");
  const approvalPath = path.join(loopDir, "approval.json");
  writeJson(experimentInput, experiment);
  await main([
    "approval",
    "create",
    loopDir,
    "--experiment",
    experimentInput,
    "--approver",
    "human-reviewer",
    "--reason",
    "Matched benchmark evidence passed review.",
    "--out",
    approvalPath
  ]);
  const promoted = recordExperiment(loop, experiment, { approval: readData(approvalPath) });
  assert.equal(promoted.assessment.outcome, "promoted");
  assert.equal(readData(path.join(loopDir, "strategy.json")).version, 2);
  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(state.evolution.currentStrategyVersion, 2);
  assert.equal(state.evolution.pendingExperiment, null);
  assert.equal(state.evolution.runsSincePromotion, 0);
  const history = state.evolution.history.find((entry) => entry.experimentId === experiment.experimentId);
  assert.equal(typeof history.artifact, "string");
  assert.equal(typeof history.approval.artifact, "string");
  assert.equal(fs.existsSync(path.resolve(loopDir, history.approval.artifact)), true);
});

test("a human can reject a pending experiment without unlocking an immediate retry", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-human-reject-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const experiment = materializeExperiment(loop, strategyExperiment({ experimentId: "human-rejected-v2" }));
  recordExperiment(loop, experiment);

  const noOpMigration = migrateLoopState(resolveLoop(loopDir));
  assert.equal(noOpMigration.alreadyMigrated, true);
  assert.equal(readData(loop.statePath).evolution.pendingExperiment.experimentId, experiment.experimentId);
  assert.throws(
    () => rollbackStrategy(loop, 1, { actor: "human-reviewer", reason: "Do not orphan pending review." }),
    /Reject or approve the pending experiment/
  );

  const experimentInput = path.join(loopDir, "human-rejected-experiment.json");
  writeJson(experimentInput, experiment);
  await main([
    "experiment",
    "reject",
    loopDir,
    "--experiment",
    experimentInput,
    "--actor",
    "human-reviewer",
    "--reason",
    "The benchmark evidence is insufficient for promotion."
  ]);
  const rejectedState = readData(loop.statePath);
  const rejectedHistory = rejectedState.evolution.history.find((entry) => entry.experimentId === experiment.experimentId);
  assert.equal(rejectedState.evolution.pendingExperiment, null);
  assert.equal(rejectedState.evolution.runsSinceExperiment, 0);
  assert.equal(rejectedHistory.outcome, "abandoned");
  assert.equal(fs.existsSync(path.resolve(loopDir, rejectedHistory.decision.artifact)), true);
  assert.equal(nextRun(loop).evolution.due, false);

  const immediate = structuredClone(experiment);
  immediate.experimentId = "immediate-after-human-reject-v2";
  assert.throws(() => recordExperiment(loop, immediate), /not due under the configured run\/failure trigger/);

  const runBase = Date.now() + 1_000;
  let now;
  for (let index = 1; index <= 3; index += 1) {
    const startedAt = new Date(runBase + index * 1_000);
    const finishedAt = new Date(startedAt.getTime() + 500);
    now = new Date(finishedAt.getTime() + 100);
    recordRun(loop, bindEvaluatorEvidence(loop, developmentRunLog(index, {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      discovered: [{ id: `feature-${index}`, summary: "feature", source: "manual" }]
    })), { now });
  }
  assert.equal(nextRun(loop, now).evolution.due, true);
  const restaged = structuredClone(experiment);
  restaged.experimentId = "after-new-evidence-v2";
  assert.equal(recordExperiment(loop, restaged).assessment.outcome, "pending-review");
});

test("strategy transaction recovery completes partial promotion with immutable approval", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-recover-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const experiment = materializeExperiment(loop, strategyExperiment({ experimentId: "recover-promotion-v2" }));
  recordExperiment(loop, experiment);
  const stagedState = readData(loop.statePath);
  const strategyV1 = readData(loop.strategyPath);
  const approval = approvalFor(experiment);
  recordExperiment(loop, experiment, { approval });
  const promotedState = readData(loop.statePath);
  const strategyV2 = readData(loop.strategyPath);
  const approvalPath = path.resolve(loopDir, promotedState.evolution.history[0].approval.artifact);
  const v1Path = path.join(loop.strategyArchiveDir, "v1.json");
  const v2Path = path.join(loop.strategyArchiveDir, "v2.json");

  // Restore the staged snapshot, then simulate a crash after only the active
  // strategy replacement landed.
  writeJson(loop.statePath, stagedState);
  fs.rmSync(approvalPath);
  fs.rmSync(v2Path);
  writeJson(loop.strategyPath, strategyV2);
  const journalPath = path.join(loopDir, "locks", "state-transaction.json");
  writeJson(journalPath, transactionJournal(loop, "experiment-promoted", stagedState, [
      transactionWrite(loopDir, approvalPath, approval, { immutable: true, schema: "approval" }),
      transactionWrite(loopDir, v1Path, strategyV1, { immutable: true, schema: "strategy" }),
      transactionWrite(loopDir, v2Path, strategyV2, { immutable: true, schema: "strategy" }),
      transactionWrite(loopDir, loop.strategyPath, strategyV2, { schema: "strategy" }),
      transactionWrite(loopDir, loop.statePath, promotedState, { schema: "state" })
  ]));

  nextRun(loop);
  assert.equal(fs.existsSync(journalPath), false);
  assert.equal(readData(loop.statePath).evolution.currentStrategyVersion, 2);
  assert.equal(readData(loop.strategyPath).version, 2);
  assert.equal(fs.existsSync(approvalPath), true);
  assert.equal(fs.existsSync(v2Path), true);
  assert.equal(recordExperiment(loop, experiment, { approval }).replayed, true);
});

test("pending experiment recovery binds staging time after all evaluation evidence", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-forged-staging-time-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const experiment = materializeExperiment(loop, strategyExperiment({ experimentId: "forged-stage-time-v2" }));
  const beforeState = readData(loop.statePath);
  const staged = recordExperiment(loop, experiment);
  const forgedState = readData(loop.statePath);
  forgedState.evolution.pendingExperiment.stagedAt = "2000-01-01T00:00:00Z";
  fs.rmSync(staged.experimentFile);
  writeJson(loop.statePath, beforeState);
  const journalPath = path.join(loopDir, "locks", "state-transaction.json");
  writeJson(journalPath, transactionJournal(loop, "experiment-pending-review", beforeState, [
    transactionWrite(loopDir, staged.experimentFile, experiment, { immutable: true, schema: "experiment" }),
    transactionWrite(loopDir, loop.statePath, forgedState, { schema: "state" })
  ]));

  assert.throws(
    () => nextRun(loop),
    /stagedAt must follow its evidence and bind the transaction time/
  );
  assert.equal(readData(loop.statePath).evolution.pendingExperiment, null);
});

test("promotion recovery requires the exact pending experiment authorization", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-forged-promotion-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const experiment = materializeExperiment(loop, strategyExperiment({ experimentId: "forged-promotion-v2" }));
  const unauthorizedBefore = readData(loop.statePath);
  unauthorizedBefore.evolution.runsSinceExperiment = 0;
  unauthorizedBefore.evolution.consecutiveFailuresSinceExperiment = 0;
  const strategyV1 = readData(loop.strategyPath);
  recordExperiment(loop, experiment);
  const approval = approvalFor(experiment);
  recordExperiment(loop, experiment, { approval });
  const promotedState = readData(loop.statePath);
  const strategyV2 = readData(loop.strategyPath);
  const history = promotedState.evolution.history.find((entry) => entry.experimentId === experiment.experimentId);
  const approvalPath = path.resolve(loopDir, history.approval.artifact);
  const v1Path = path.join(loop.strategyArchiveDir, "v1.json");
  const v2Path = path.join(loop.strategyArchiveDir, "v2.json");

  writeJson(loop.statePath, unauthorizedBefore);
  writeJson(loop.strategyPath, strategyV1);
  fs.rmSync(approvalPath);
  fs.rmSync(v2Path);
  const journalPath = path.join(loopDir, "locks", "state-transaction.json");
  writeJson(journalPath, transactionJournal(loop, "experiment-promoted", unauthorizedBefore, [
    transactionWrite(loopDir, approvalPath, approval, { immutable: true, schema: "approval" }),
    transactionWrite(loopDir, v1Path, strategyV1, { immutable: true, schema: "strategy" }),
    transactionWrite(loopDir, v2Path, strategyV2, { immutable: true, schema: "strategy" }),
    transactionWrite(loopDir, loop.strategyPath, strategyV2, { schema: "strategy" }),
    transactionWrite(loopDir, loop.statePath, promotedState, { schema: "state" })
  ]));

  assert.throws(
    () => nextRun(loop),
    /not authorized by its exact pending experiment state/
  );
  assert.equal(readData(loop.strategyPath).version, 1);
  assert.equal(readData(loop.statePath).evolution.currentStrategyVersion, 1);
});

test("strategy evolution rejects candidates below the configured improvement threshold", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-reject-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const raw = strategyExperiment({ experimentId: "weak-v2" });
  raw.candidate.score = 0.65;
  raw.candidate.results[0].score = 0.6;
  raw.candidate.results[1].score = 0.65;
  raw.candidate.results[2].score = 0.7;
  const experiment = materializeExperiment(loop, raw);
  const outcome = recordExperiment(loop, experiment);
  assert.equal(outcome.assessment.outcome, "rejected");
  assert.equal(readData(path.join(loopDir, "strategy.json")).version, 1);
});

test("strategy evolution rejects a high-scoring candidate with any failed benchmark case", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-failed-case-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const raw = strategyExperiment({ experimentId: "failed-case-v2" });
  raw.candidate.results[0].verdict = "fail";
  raw.candidate.results[0].evaluation.evidence[0].exitCode = 1;
  const outcome = recordExperiment(loop, materializeExperiment(loop, raw));
  assert.equal(outcome.assessment.candidatePassed, false);
  assert.equal(outcome.assessment.outcome, "rejected");
  assert.equal(readData(path.join(loopDir, "strategy.json")).version, 1);
});

test("strategy evolution requires configured digest-bound evaluator identity", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-evaluator-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const wrongTopLevel = materializeExperiment(loop, strategyExperiment({ experimentId: "wrong-top-evaluator" }));
  wrongTopLevel.evaluator.identity = "unconfigured-strategy-reviewer";
  assert.throws(() => recordExperiment(loop, wrongTopLevel), /must match evolution\.evaluator\.name/);

  const wrongCaseRaw = strategyExperiment({ experimentId: "wrong-case-evaluator" });
  wrongCaseRaw.candidate.results[0].evaluation.identity = "unconfigured-strategy-reviewer";
  const wrongCase = materializeExperiment(loop, wrongCaseRaw);
  assert.throws(() => recordExperiment(loop, wrongCase), /Benchmark case case-1 evaluator identity/);

  const wrongDigest = materializeExperiment(loop, strategyExperiment({ experimentId: "wrong-attestation-digest" }));
  wrongDigest.evaluator.benchmarkSha256 = "f".repeat(64);
  assert.throws(() => recordExperiment(loop, wrongDigest), /benchmarkSha256/);

  const duplicateRaw = strategyExperiment({ experimentId: "duplicate-evolution-command" });
  duplicateRaw.evidence.push({ command: "npm test", exitCode: 1, summary: "Conflicting duplicate." });
  const duplicateEvidence = materializeExperiment(loop, duplicateRaw);
  assert.throws(() => recordExperiment(loop, duplicateEvidence), /duplicate command evidence/);
});

test("strategy experiment replay requires matching immutable state history", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-replay-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loopDir = path.join(tmp, "self-improving-development");
  const loop = resolveLoop(loopDir);
  const precreated = materializeExperiment(loop, strategyExperiment({ experimentId: "precreated-experiment" }));
  writeJson(path.join(loop.experimentDir, "raw-precreated-experiment.json"), precreated);
  assert.throws(() => recordExperiment(loop, precreated), /without a state history entry/);

  const replayable = materializeExperiment(loop, strategyExperiment({ experimentId: "replayable-experiment" }));
  recordExperiment(loop, replayable);
  const replay = recordExperiment(loop, replayable);
  assert.equal(replay.replayed, true);
  assert.equal(
    readData(path.join(loopDir, "state.json")).evolution.history
      .filter((entry) => entry.experimentId === "replayable-experiment").length,
    1
  );

  const state = readData(loop.statePath);
  const entry = state.evolution.history.find((item) => item.experimentId === "replayable-experiment");
  const currentArtifact = path.resolve(loop.loopDir, entry.artifact);
  const legacyArtifact = path.join(loop.experimentDir, "replayable-experiment.json");
  fs.renameSync(currentArtifact, legacyArtifact);
  delete entry.artifact;
  writeJson(loop.statePath, state);
  assert.equal(recordExperiment(loop, replayable).replayed, true);
});

test("strategy approval is bound to the exact staged experiment digest", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-approval-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const experiment = materializeExperiment(loop, strategyExperiment());
  recordExperiment(loop, experiment);
  const tampered = structuredClone(experiment);
  tampered.candidate.strategy.instructions += " Then skip a check.";

  assert.throws(
    () => recordExperiment(loop, tampered, { approval: approvalFor(experiment) }),
    /currently pending experiment digest/
  );

  const futureApproval = approvalFor(experiment);
  futureApproval.approvedAt = "2099-01-01T00:00:00Z";
  assert.throws(
    () => recordExperiment(loop, experiment, { approval: futureApproval }),
    /cannot be in the future/
  );
  const selfApproval = approvalFor(experiment);
  selfApproval.approver = loop.spec.evolution.evaluator.name;
  assert.throws(
    () => recordExperiment(loop, experiment, { approval: selfApproval }),
    /approver must be independent/
  );

  const state = readData(loop.statePath);
  state.evolution.pendingExperiment.stagedAt = "2000-01-01T00:00:00Z";
  writeJson(loop.statePath, state);
  const preEvidenceApproval = approvalFor(experiment);
  preEvidenceApproval.approvedAt = "2001-01-01T00:00:00Z";
  assert.throws(
    () => recordExperiment(loop, experiment, { approval: preEvidenceApproval }),
    /cannot predate the staged experiment/
  );
});

test("human-reviewed promotion replay requires its persisted approval history", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-approval-audit-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const experiment = materializeExperiment(loop, strategyExperiment({ experimentId: "approval-audit-v2" }));
  recordExperiment(loop, experiment);
  recordExperiment(loop, experiment, { approval: approvalFor(experiment) });
  const state = readData(loop.statePath);
  delete state.evolution.history[0].approval;
  writeJson(loop.statePath, state);
  assert.throws(() => recordExperiment(loop, experiment), /missing its persisted approval/);
});

test("strategy rollback restores archived behavior as a new monotonic version", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-rollback-"));
  await main([
    "init",
    "self-improving-development",
    "--from",
    "examples/self-improving-development/loop.yaml",
    "--out",
    tmp
  ]);
  const loop = resolveLoop(path.join(tmp, "self-improving-development"));
  const original = readData(path.join(loop.loopDir, "strategy.json"));
  const experiment = materializeExperiment(loop, strategyExperiment());
  recordExperiment(loop, experiment);
  recordExperiment(loop, experiment, { approval: approvalFor(experiment) });

  const outcome = rollbackStrategy(loop, 1, {
    actor: "human-reviewer",
    reason: "Post-promotion evidence regressed."
  });
  assert.equal(outcome.strategy.version, 3);
  assert.equal(outcome.restoredFromVersion, 1);
  assert.equal(outcome.strategy.instructions, original.instructions);
  assert.equal(fs.existsSync(path.join(loop.loopDir, "strategies", "v3.json")), true);
  assert.equal(outcome.state.evolution.rollbackHistory.length, 1);
});

test("record fails closed on empty success and hard budget overruns", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const emptySuccess = runLog({
    status: "passed",
    discovered: [],
    results: [],
    budget: { runtimeMinutes: 1, itemsAttempted: 0, estimatedUsd: 0 }
  });
  assert.throws(() => recordRun(loop, emptySuccess), /passed run requires at least one result/);

  const expensive = bindEvaluatorEvidence(loop, runLog({
    budget: { runtimeMinutes: 20, itemsAttempted: 1, estimatedUsd: 999 }
  }));
  assert.throws(() => recordRun(loop, expensive), /exceeds maxEstimatedUsdPerRun/);
});

test("check validates data files against protocol schemas", async () => {
  const priorExitCode = process.exitCode;
  process.exitCode = undefined;
  await main(["check", "evaluator", "templates/evaluator-result.json"]);
  assert.equal(process.exitCode, undefined);

  await main(["check", "run-log", "templates/evaluator-result.json"]);
  assert.equal(process.exitCode, 1);
  process.exitCode = priorExitCode;
});

test("rendered executor skill is an operational playbook", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-skill-"));
  await main(["render", "codex", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const skill = fs.readFileSync(path.join(tmp, ".agents", "skills", "ci-triage", "SKILL.md"), "utf8");

  assert.match(skill, /loopctl next \.loop-engineering\/loops\/ci-triage/);
  assert.match(skill, /loopctl record \.loop-engineering\/loops\/ci-triage --run/);
  assert.match(skill, /git worktree add/);
  assert.match(skill, /loopctl check evaluator/);
  assert.match(skill, /gh run list --status failure/);
});

test("rendered evolution skill loads strategy and uses benchmark-gated promotion", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-skill-"));
  await main(["render", "codex", "examples/self-improving-development/loop.yaml", "--out", tmp]);
  const skill = fs.readFileSync(path.join(tmp, ".agents", "skills", "self-improving-development", "SKILL.md"), "utf8");

  assert.match(skill, /strategy\.json/);
  assert.match(skill, /loopctl evolve/);
  assert.match(skill, /improve by at least.*0\.1/i);
  assert.match(skill, /Never approve your own strategy/);
});

test("rendered chatgpt adapter is an advisor, not an executor", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-chatgpt-"));
  await main(["render", "chatgpt", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const instructions = fs.readFileSync(path.join(tmp, "chatgpt", "ci-triage", "instructions.md"), "utf8");

  assert.match(instructions, /cannot execute this loop/);
  assert.doesNotMatch(instructions, /git worktree/);
});

test("github-actions scaffold is manual, read-only, and gates on loopctl next", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-gha-"));
  await main(["render", "github-actions-scaffold", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const workflow = fs.readFileSync(path.join(tmp, ".github", "workflows", "ci-triage.yml"), "utf8");

  assert.match(workflow, /loopctl next '\.loop-engineering\/loops\/ci-triage'/);
  assert.match(workflow, /if: steps\.next\.outputs\.ok == 'true'/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /intentionally performs preflight only/);
});
