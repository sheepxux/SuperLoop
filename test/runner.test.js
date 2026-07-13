import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { main } from "../src/cli.js";
import { daemonMain } from "../src/daemon-cli.js";
import { readData, writeJson, writeYaml } from "../src/fs-utils.js";
import { acquireLease, releaseLease, renewLease, writeLease } from "../src/lease.js";
import { listRuns, runTick, setPaused, statusLoops } from "../src/runner.js";

async function initRunnerLoop(name = "runner-loop", mutate = null) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-runner-"));
  const root = path.join(tmp, "loops");
  let source = "templates/loop.yaml";
  if (mutate) {
    const spec = readData(source);
    mutate(spec, tmp);
    source = path.join(tmp, "loop.yaml");
    writeYaml(source, spec);
  }
  await main(["init", name, "--from", source, "--out", root]);
  return { tmp, root, loopDir: path.join(root, name) };
}

function leaseBinding(loopDir) {
  const state = readData(path.join(loopDir, "state.json"));
  return { generation: state.generation, contractSha256: state.contractSha256 };
}

test("loopd dry-run creates durable artifacts without counting task success or budget", async () => {
  const { root, loopDir } = await initRunnerLoop();
  const now = new Date("2026-07-10T12:00:00Z");
  const outcomes = runTick({ root, loopName: "runner-loop", now, forceManual: true });

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "dry-run");
  assert.equal(fs.existsSync(path.join(outcomes[0].runDir, "run-log.json")), true);
  assert.equal(fs.existsSync(path.join(outcomes[0].runDir, "events.ndjson")), true);
  assert.equal(fs.existsSync(path.join(outcomes[0].runDir, "summary.md")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "locks", "active-run.json")), false);

  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(state.budgets.runsToday, 0);
  assert.equal(state.lastRunAt, null);
  assert.equal(readData(outcomes[0].runFile).status, "dry-run");
  assert.equal(listRuns(loopDir).length, 1);
});

test("file leases prevent overlapping runs and recover expired holders", async () => {
  const { loopDir } = await initRunnerLoop("lease-loop");
  const now = new Date("2026-07-10T12:00:00Z");
  const first = acquireLease(loopDir, "run-a", 10, { now });
  assert.equal(first.acquired, true);

  const second = acquireLease(loopDir, "run-b", 10, { now });
  assert.equal(second.acquired, false);
  assert.equal(second.lease.runId, "run-a");
  assert.equal(releaseLease(first.leasePath, first.lease.token), true);

  writeLease(loopDir, {
    ...leaseBinding(loopDir),
    token: "expired-owner-token",
    runId: "expired-run",
    pid: 1,
    hostname: "old-host",
    startedAt: "2026-07-10T10:00:00Z",
    heartbeatAt: "2026-07-10T10:30:00Z",
    expiresAt: "2026-07-10T11:00:00Z"
  });
  const recovered = acquireLease(loopDir, "run-c", 10, { now });
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.recovered.runId, "expired-run");
  releaseLease(recovered.leasePath, recovered.lease.token);
});

test("malformed leases fail closed instead of being recovered", async () => {
  const { loopDir } = await initRunnerLoop("malformed-lease-loop");
  const leasePath = path.join(loopDir, "locks", "active-run.json");
  fs.mkdirSync(path.dirname(leasePath), { recursive: true });
  fs.writeFileSync(leasePath, "{\n");

  assert.throws(
    () => acquireLease(loopDir, "replacement-run", 10, { now: new Date("2026-07-10T12:00:00Z") }),
    /Invalid active lease.*refusing automatic recovery/
  );
  assert.equal(fs.readFileSync(leasePath, "utf8"), "{\n");
});

test("concurrent expired lease recovery elects exactly one owner", async () => {
  const { loopDir } = await initRunnerLoop("concurrent-recovery-loop");
  writeLease(loopDir, {
    ...leaseBinding(loopDir),
    token: "expired-owner-token",
    runId: "expired-run",
    pid: 1,
    hostname: "old-host",
    startedAt: "2026-07-10T10:00:00Z",
    heartbeatAt: "2026-07-10T10:30:00Z",
    expiresAt: "2026-07-10T11:00:00Z"
  });

  const triggerPath = path.join(loopDir, "start-recovery");
  const contenders = Array.from({ length: 8 }, (_, index) => {
    return acquireLeaseInChild(loopDir, `contender-${index}`, triggerPath);
  });
  await Promise.all(contenders.map((contender) => contender.ready));
  fs.writeFileSync(triggerPath, "start\n");
  const results = await Promise.all(contenders.map((contender) => contender.result));

  assert.equal(results.filter((result) => result.acquired).length, 1);
  const active = readData(path.join(loopDir, "locks", "active-run.json"));
  assert.equal(results.find((result) => result.acquired).token, active.token);
});

test("release and renewal leave a replacement owner untouched", async () => {
  const { loopDir } = await initRunnerLoop("replacement-owner-loop");
  const now = new Date("2026-07-10T12:00:00Z");
  const original = acquireLease(loopDir, "original-run", 10, { now });
  const replacement = {
    ...leaseBinding(loopDir),
    token: "replacement-owner-token",
    runId: "replacement-run",
    pid: 2,
    hostname: "new-host",
    startedAt: "2026-07-10T12:01:00Z",
    heartbeatAt: "2026-07-10T12:01:00Z",
    expiresAt: "2026-07-10T12:20:00Z"
  };
  writeLease(loopDir, replacement);

  assert.equal(releaseLease(original.leasePath, original.lease.token), false);
  assert.equal(renewLease(original.leasePath, original.lease.token, 10, { now }), false);
  assert.deepEqual(readData(original.leasePath), replacement);
});

function acquireLeaseInChild(loopDir, runId, triggerPath) {
  const moduleUrl = new URL("../src/lease.js", import.meta.url).href;
  const script = `
import fs from "node:fs";
import { acquireLease } from ${JSON.stringify(moduleUrl)};
const wait = new Int32Array(new SharedArrayBuffer(4));
process.stdout.write("ready\\n");
const triggerDeadline = Date.now() + 5_000;
while (!fs.existsSync(process.argv[3])) {
  if (Date.now() >= triggerDeadline) throw new Error("Timed out waiting for recovery trigger");
  Atomics.wait(wait, 0, 0, 2);
}
const result = acquireLease(process.argv[1], process.argv[2], 10, { now: new Date("2026-07-10T12:00:00Z") });
process.stdout.write(JSON.stringify({ acquired: result.acquired, token: result.lease?.token || null }) + "\\n");
`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script, loopDir, runId, triggerPath], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let markReady;
  let failReady;
  let isReady = false;
  const ready = new Promise((resolve, reject) => {
    markReady = () => {
      isReady = true;
      resolve();
    };
    failReady = reject;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("ready\n")) markReady();
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = new Promise((resolve, reject) => {
    child.on("error", (error) => {
      if (!isReady) failReady(error);
      reject(error);
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        const error = new Error(`Lease contender exited with ${code}: ${stderr}`);
        if (!isReady) failReady(error);
        reject(error);
        return;
      }
      const lines = stdout.trim().split("\n");
      resolve(JSON.parse(lines.at(-1)));
    });
  });
  return { ready, result };
}

test("paused loops are skipped until resumed", async () => {
  const { root, loopDir } = await initRunnerLoop("paused-loop");
  setPaused(loopDir, true, "maintenance");

  const skipped = runTick({
    root,
    loopName: "paused-loop",
    now: new Date("2026-07-10T12:00:00Z"),
    forceManual: true
  });
  assert.equal(skipped[0].status, "skipped");
  assert.equal(skipped[0].reason, "paused");

  setPaused(loopDir, false);
  const resumed = runTick({
    root,
    loopName: "paused-loop",
    now: new Date("2026-07-10T12:01:00Z"),
    forceManual: true
  });
  assert.equal(resumed[0].status, "dry-run");
});

test("interval cadence skips recent loops and runs due loops", async () => {
  const { root, loopDir } = await initRunnerLoop("cadence-loop", (spec) => {
    spec.schedule.runtime = "custom";
    spec.schedule.cadence = "every 1h";
  });
  const now = new Date("2026-07-10T12:00:00Z");
  const statePath = path.join(loopDir, "state.json");
  const state = readData(statePath);
  state.lastRunAt = "2026-07-10T11:30:00Z";
  writeJson(statePath, state);

  const recent = runTick({ root, now });
  assert.equal(recent[0].reason, "not-due");

  state.lastRunAt = "2026-07-10T10:00:00Z";
  writeJson(statePath, state);
  const due = runTick({ root, now });
  assert.equal(due[0].status, "dry-run");
});

test("runner rechecks cadence after acquiring the lease", async () => {
  const { root, loopDir } = await initRunnerLoop("cadence-race-loop", (spec) => {
    spec.schedule.runtime = "custom";
    spec.schedule.cadence = "every 1h";
  });
  const now = new Date("2026-07-10T12:00:00Z");
  const statePath = path.join(loopDir, "state.json");
  const state = readData(statePath);
  state.lastRunAt = "2026-07-10T10:00:00Z";
  writeJson(statePath, state);

  const contender = holdLeaseOperationUntilContender(loopDir, statePath, now.toISOString());
  await contender.ready;
  const [outcome] = runTick({ root, now });
  await contender.done;

  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.reason, "not-due");
  assert.equal(outcome.recheckedAfterLease, true);
  assert.equal(readData(statePath).budgets.runsToday, 0);
  assert.equal(fs.existsSync(path.join(loopDir, "locks", "active-run.json")), false);
});

test("default runner clock is refreshed per loop while an injected clock stays deterministic", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-runner-clock-"));
  const root = path.join(tmp, "loops");
  await main(["init", "clock-a", "--from", "templates/loop.yaml", "--out", root]);
  await main(["init", "clock-b", "--from", "templates/loop.yaml", "--out", root]);

  const RealDate = globalThis.Date;
  let calls = 0;
  class SteppingDate extends RealDate {
    constructor(...args) {
      if (args.length > 0) {
        super(...args);
      } else {
        super(RealDate.parse("2026-07-10T12:00:00Z") + calls * 1_000);
        calls += 1;
      }
    }
  }
  globalThis.Date = SteppingDate;
  let liveOutcomes;
  try {
    liveOutcomes = runTick({ root, forceManual: true });
  } finally {
    globalThis.Date = RealDate;
  }
  const liveStarts = liveOutcomes.map((outcome) => readData(outcome.runFile).startedAt);
  assert.notEqual(liveStarts[0], liveStarts[1]);

  const deterministic = new RealDate("2026-07-10T13:00:00Z");
  const deterministicOutcomes = runTick({ root, now: deterministic, forceManual: true });
  const deterministicStarts = deterministicOutcomes.map((outcome) => readData(outcome.runFile).startedAt);
  assert.deepEqual(deterministicStarts, [deterministic.toISOString(), deterministic.toISOString()]);
});

test("listing runs performs transaction recovery before scanning artifacts", async () => {
  const { loopDir } = await initRunnerLoop("runs-recovery-loop");
  const journal = path.join(loopDir, "locks", "state-transaction.json");
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  fs.writeFileSync(journal, "{\n");

  assert.throws(() => listRuns(loopDir), /transaction journal is unreadable/i);
});

test("loopd --once exits nonzero when a scheduler outcome is an error", async () => {
  const { root, loopDir } = await initRunnerLoop("daemon-error-loop");
  fs.writeFileSync(path.join(loopDir, "state.json"), "{\n");
  const priorExitCode = process.exitCode;
  const priorLog = console.log;
  process.exitCode = undefined;
  console.log = () => {};
  try {
    await daemonMain(["start", "--once", "--root", root, "--loop", "daemon-error-loop"]);
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = priorLog;
    process.exitCode = priorExitCode;
  }
});

test("command executor consumes a structured draft run log", async () => {
  const { root, loopDir } = await initRunnerLoop("command-loop", (spec, tmp) => {
    const script = path.join(tmp, "executor.cjs");
    fs.writeFileSync(script, `
const fs = require("node:fs");
const log = {
  apiVersion: "loop-engineering/v1",
  loop: "command-loop",
  runId: process.env.LOOP_RUN_ID,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  status: "no-work",
  discovered: [],
  results: [],
  budget: { runtimeMinutes: 0, itemsAttempted: 0, estimatedUsd: 0 }
};
fs.writeFileSync(process.env.LOOP_RUN_LOG, JSON.stringify(log));
process.stdout.write("executor complete");
`);
    spec.runner.executor = "command";
    spec.runner.command = `node ${JSON.stringify(script)}`;
  });

  const outcomes = runTick({
    root,
    loopName: "command-loop",
    now: new Date("2026-07-10T12:00:00Z"),
    allowCommand: true,
    forceManual: true
  });
  assert.equal(outcomes[0].status, "ran");
  assert.equal(readData(outcomes[0].runFile).status, "no-work");
  assert.match(fs.readFileSync(path.join(outcomes[0].runDir, "stdout.log"), "utf8"), /executor complete/);
  assert.equal(readData(path.join(loopDir, "state.json")).budgets.runsToday, 1);
});

test("command executors cannot backdate Runner time to bypass the daily budget", async () => {
  const { root, loopDir, tmp } = await initRunnerLoop("backdated-command-loop", (spec, fixtureRoot) => {
    const script = path.join(fixtureRoot, "backdated-command.cjs");
    const counter = path.join(fixtureRoot, "executions.txt");
    fs.writeFileSync(script, `
const fs = require("node:fs");
const counter = ${JSON.stringify(counter)};
fs.appendFileSync(counter, "executed\\n");
fs.writeFileSync(process.env.LOOP_RUN_LOG, JSON.stringify({
  apiVersion: "loop-engineering/v1",
  loop: "backdated-command-loop",
  runId: process.env.LOOP_RUN_ID,
  startedAt: "2020-01-01T00:00:00Z",
  finishedAt: "2020-01-01T00:01:00Z",
  status: "no-work",
  discovered: [],
  results: [],
  budget: { runtimeMinutes: 0, itemsAttempted: 0, estimatedUsd: 0 }
}));
`);
    spec.runner.executor = "command";
    spec.runner.command = `node ${JSON.stringify(script)}`;
    spec.safety.budgets.maxDailyRuns = 2;
  });

  const outcomes = [];
  for (let index = 0; index < 3; index += 1) {
    outcomes.push(runTick({
      root,
      loopName: "backdated-command-loop",
      allowCommand: true,
      forceManual: true
    })[0]);
  }
  assert.deepEqual(outcomes.map((entry) => entry.status), ["ran", "ran", "skipped"]);
  assert.equal(outcomes[2].reason, "preflight-blocked");
  assert.match(outcomes[2].reasons.join("\n"), /Daily run budget exhausted/);
  assert.equal(fs.readFileSync(path.join(tmp, "executions.txt"), "utf8").trim().split("\n").length, 2);
  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(state.budgets.runsToday, 2);
  assert.equal(state.budgets.date, new Date().toISOString().slice(0, 10));
});

test("evolution command runs receive and persist the lease-frozen strategy binding", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-evolution-runner-"));
  const root = path.join(tmp, "loops");
  const spec = readData("examples/self-improving-development/loop.yaml");
  const script = path.join(tmp, "evolution-executor.cjs");
  fs.writeFileSync(script, `
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
if (!process.env.LOOP_STRATEGY_VERSION || !/^[a-f0-9]{64}$/.test(process.env.LOOP_STRATEGY_SHA256 || "")) {
  process.exit(4);
}
const now = new Date().toISOString();
const itemId = "feature-1";
const contextId = "independent-evolution-run-evaluator";
const evaluatorDir = path.join(process.env.LOOP_DIR, "evaluators");
fs.mkdirSync(evaluatorDir, { recursive: true });
const evaluatorPath = path.join(evaluatorDir, "feature-1.json");
const evaluator = {
  apiVersion: "loop-engineering/v1",
  loop: "evolution-command-loop",
  itemId,
  evaluator: { identity: "development-evaluator", contextId, evaluatedAt: now },
  verdict: "pass",
  evidence: [
    { type: "tests", summary: "Tests passed." },
    { type: "diff-review", summary: "Diff reviewed." },
    { type: "command", summary: "Configured command passed.", command: "npm test", exitCode: 0 }
  ],
  reasons: [],
  nextAction: "accept"
};
const raw = JSON.stringify(evaluator, null, 2) + "\\n";
fs.writeFileSync(evaluatorPath, raw);
const digest = crypto.createHash("sha256").update(raw).digest("hex");
fs.writeFileSync(process.env.LOOP_RUN_LOG, JSON.stringify({
  apiVersion: "loop-engineering/v1",
  loop: "evolution-command-loop",
  runId: process.env.LOOP_RUN_ID,
  startedAt: now,
  finishedAt: now,
  status: "passed",
  discovered: [{ id: itemId, summary: "Bounded feature", source: "manual" }],
  results: [{
    itemId,
    verdict: "pass",
    summary: "Verified",
    evaluator: { artifact: "evaluators/feature-1.json", sha256: digest, contextId }
  }],
  budget: { runtimeMinutes: 0, itemsAttempted: 1, estimatedUsd: 0 },
  metrics: { "verified-pass-rate": 1 }
}));
`);
  spec.runner.executor = "command";
  spec.runner.command = `node ${JSON.stringify(script)}`;
  const source = path.join(tmp, "loop.yaml");
  writeYaml(source, spec);
  await main(["init", "evolution-command-loop", "--from", source, "--out", root]);
  const loopDir = path.join(root, "evolution-command-loop");

  const [outcome] = runTick({
    root,
    loopName: "evolution-command-loop",
    allowCommand: true,
    forceManual: true
  });
  assert.equal(outcome.status, "ran");
  const recorded = readData(outcome.runFile);
  const state = readData(path.join(loopDir, "state.json"));
  assert.deepEqual(recorded.strategy, {
    version: state.evolution.currentStrategyVersion,
    sha256: state.evolution.currentStrategySha256
  });
  assert.equal(state.evolution.observations[0].strategySha256, recorded.strategy.sha256);
  assert.equal(state.evolution.runsSinceExperiment, 1);
});

test("command executor cannot report real execution as an uncounted dry-run", async () => {
  const { root, loopDir } = await initRunnerLoop("command-dry-run-loop", (spec, tmp) => {
    const script = path.join(tmp, "dry-run-executor.cjs");
    fs.writeFileSync(script, `
const fs = require("node:fs");
fs.writeFileSync(process.env.LOOP_RUN_LOG, JSON.stringify({
  apiVersion: "loop-engineering/v1",
  loop: "command-dry-run-loop",
  runId: process.env.LOOP_RUN_ID,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  status: "dry-run",
  discovered: [],
  results: [],
  budget: { runtimeMinutes: 0, itemsAttempted: 0, estimatedUsd: 0 }
}));
`);
    spec.runner.executor = "command";
    spec.runner.command = `node ${JSON.stringify(script)}`;
  });

  const [outcome] = runTick({
    root,
    loopName: "command-dry-run-loop",
    now: new Date("2026-07-10T12:00:00Z"),
    allowCommand: true,
    forceManual: true
  });
  assert.equal(outcome.status, "failed");
  assert.equal(readData(path.join(loopDir, "state.json")).budgets.runsToday, 1);
  assert.equal(readData(outcome.runFile).failure.type, "invalid-run-log");
});

test("malformed command draft becomes a counted terminal failure", async () => {
  const { root, loopDir } = await initRunnerLoop("malformed-draft-loop", (spec, tmp) => {
    const script = path.join(tmp, "malformed-executor.cjs");
    fs.writeFileSync(script, `
const fs = require("node:fs");
fs.writeFileSync(process.env.LOOP_RUN_LOG, JSON.stringify({ unexpected: true }));
`);
    spec.runner.executor = "command";
    spec.runner.command = `node ${JSON.stringify(script)}`;
  });

  const [outcome] = runTick({
    root,
    loopName: "malformed-draft-loop",
    now: new Date("2026-07-10T12:00:00Z"),
    allowCommand: true,
    forceManual: true
  });
  assert.equal(outcome.status, "failed");
  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(state.budgets.runsToday, 1);
  assert.notEqual(state.lastRunAt, null);
  assert.equal(readData(outcome.runFile).failure.type, "invalid-run-log");
});

test("command budget overruns are durably counted with observed usage", async () => {
  const { root, loopDir } = await initRunnerLoop("budget-overrun-loop", (spec, tmp) => {
    const script = path.join(tmp, "budget-overrun.cjs");
    fs.writeFileSync(script, `
const fs = require("node:fs");
const now = new Date().toISOString();
fs.writeFileSync(process.env.LOOP_RUN_LOG, JSON.stringify({
  apiVersion: "loop-engineering/v1",
  loop: "budget-overrun-loop",
  runId: process.env.LOOP_RUN_ID,
  startedAt: now,
  finishedAt: now,
  status: "no-work",
  discovered: [],
  results: [],
  budget: { runtimeMinutes: 0, itemsAttempted: 0, estimatedUsd: 7.5 }
}));
`);
    spec.runner.executor = "command";
    spec.runner.command = `node ${JSON.stringify(script)}`;
    spec.safety.budgets.maxEstimatedUsdPerRun = 1;
  });

  const [outcome] = runTick({
    root,
    loopName: "budget-overrun-loop",
    allowCommand: true,
    forceManual: true
  });
  assert.equal(outcome.status, "failed");
  const recorded = readData(outcome.runFile);
  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(recorded.status, "budget-exceeded");
  assert.equal(recorded.failure.type, "budget-exceeded");
  assert.equal(recorded.budget.estimatedUsd, 7.5);
  assert.equal(state.budgets.runsToday, 1);
  assert.equal(state.budgets.estimatedUsdToday, 7.5);
});

test("nonzero command exits still account usage from an existing draft", async () => {
  const { root, loopDir } = await initRunnerLoop("failed-budget-loop", (spec, tmp) => {
    const script = path.join(tmp, "failed-budget.cjs");
    fs.writeFileSync(script, `
const fs = require("node:fs");
fs.writeFileSync(process.env.LOOP_RUN_LOG, JSON.stringify({
  results: [{}, {}, {}, {}],
  budget: { itemsAttempted: 4, estimatedUsd: 9 }
}));
process.exit(3);
`);
    spec.runner.executor = "command";
    spec.runner.command = `node ${JSON.stringify(script)}`;
    spec.safety.budgets.maxEstimatedUsdPerRun = 1;
  });

  const [outcome] = runTick({
    root,
    loopName: "failed-budget-loop",
    allowCommand: true,
    forceManual: true
  });
  const recorded = readData(outcome.runFile);
  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(recorded.status, "budget-exceeded");
  assert.equal(recorded.budget.itemsAttempted, 4);
  assert.equal(recorded.budget.estimatedUsd, 9);
  assert.equal(state.budgets.estimatedUsdToday, 9);
});

test("command executor requires explicit operator opt-in", async () => {
  const { root } = await initRunnerLoop("guarded-command-loop", (spec) => {
    spec.runner.executor = "command";
    spec.runner.command = "node -e \"process.exit(0)\"";
  });
  const outcomes = runTick({
    root,
    loopName: "guarded-command-loop",
    now: new Date("2026-07-10T12:00:00Z"),
    forceManual: true
  });
  assert.equal(outcomes[0].status, "skipped");
  assert.equal(outcomes[0].reason, "command-executor-disabled");
});

test("runner rejects an execution timeout longer than its lease and safety contract", async () => {
  const { root } = await initRunnerLoop("timeout-bound-loop", (spec) => {
    spec.runner.executor = "command";
    spec.runner.command = "node -e \"process.exit(0)\"";
  });
  const [outcome] = runTick({
    root,
    loopName: "timeout-bound-loop",
    timeoutMs: 24 * 60 * 60_000,
    allowCommand: true,
    forceManual: true
  });
  assert.equal(outcome.status, "error");
  assert.match(outcome.reason, /no greater than the configured/);
});

test("command failures produce a terminal failed run and release the lease", async () => {
  const { root, loopDir } = await initRunnerLoop("failed-command-loop", (spec) => {
    spec.runner.executor = "command";
    spec.runner.command = "node -e \"process.exit(3)\"";
  });

  const outcomes = runTick({
    root,
    loopName: "failed-command-loop",
    now: new Date("2026-07-10T12:00:00Z"),
    allowCommand: true,
    forceManual: true
  });
  assert.equal(outcomes[0].status, "failed");
  assert.equal(readData(outcomes[0].runFile).status, "failed");
  assert.equal(fs.existsSync(path.join(loopDir, "locks", "active-run.json")), false);
});

test("status reports runner, budget, and pause health", async () => {
  const { root, loopDir } = await initRunnerLoop("status-loop");
  setPaused(loopDir, true, "review");
  const statuses = statusLoops({ root, now: new Date("2026-07-10T12:00:00Z") });
  assert.equal(statuses[0].loop, "status-loop");
  assert.equal(statuses[0].paused, true);
  assert.equal(statuses[0].runner, "dry-run");
  assert.equal(statuses[0].preflightOk, false);
});

function holdLeaseOperationUntilContender(loopDir, statePath, lastRunAt) {
  const claimsDir = path.join(loopDir, "locks", ".lease-operations");
  const script = `
import fs from "node:fs";
import path from "node:path";
const wait = new Int32Array(new SharedArrayBuffer(4));
const [statePath, claimsDir, lastRunAt] = process.argv.slice(1);
fs.mkdirSync(claimsDir, { recursive: true });
const claim = path.join(claimsDir, Date.now() + "-" + process.pid + "-cadence-test.lock");
fs.mkdirSync(claim);
fs.writeFileSync(path.join(claim, "ticket.json"), JSON.stringify({ ticket: 1 }) + "\\n");
process.stdout.write("ready\\n");
const deadline = Date.now() + 5_000;
try {
  while (!fs.readdirSync(claimsDir).some((name) => name.endsWith(".lock") && path.join(claimsDir, name) !== claim)) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for runner lease claim");
    Atomics.wait(wait, 0, 0, 2);
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.lastRunAt = lastRunAt;
  const temporary = statePath + ".cadence-test-" + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\\n");
  fs.renameSync(temporary, statePath);
} finally {
  fs.rmSync(claim, { recursive: true, force: true });
}
`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script, statePath, claimsDir, lastRunAt], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let markReady;
  let failReady;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("ready\n")) markReady();
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      failReady(error);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`Cadence helper exited with ${code}: ${stderr}`);
        failReady(error);
        reject(error);
      }
    });
  });
  return { ready, done };
}
