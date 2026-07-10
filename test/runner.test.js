import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../src/cli.js";
import { readData, writeJson, writeYaml } from "../src/fs-utils.js";
import { acquireLease, releaseLease, writeLease } from "../src/lease.js";
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

test("loopd dry-run creates durable run artifacts and records state", async () => {
  const { root, loopDir } = await initRunnerLoop();
  const now = new Date("2026-07-10T12:00:00Z");
  const outcomes = runTick({ root, loopName: "runner-loop", now, forceManual: true });

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "ran");
  assert.equal(fs.existsSync(path.join(outcomes[0].runDir, "run-log.json")), true);
  assert.equal(fs.existsSync(path.join(outcomes[0].runDir, "events.ndjson")), true);
  assert.equal(fs.existsSync(path.join(outcomes[0].runDir, "summary.md")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "locks", "active-run.json")), false);

  const state = readData(path.join(loopDir, "state.json"));
  assert.equal(state.budgets.runsToday, 1);
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
  assert.equal(releaseLease(first.leasePath, "run-a"), true);

  writeLease(loopDir, {
    runId: "expired-run",
    pid: 1,
    hostname: "old-host",
    startedAt: "2026-07-10T10:00:00Z",
    expiresAt: "2026-07-10T11:00:00Z"
  });
  const recovered = acquireLease(loopDir, "run-c", 10, { now });
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.recovered.runId, "expired-run");
  releaseLease(recovered.leasePath, "run-c");
});

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
  assert.equal(resumed[0].status, "ran");
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
  assert.equal(due[0].status, "ran");
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
  status: "passed",
  discovered: [],
  results: [],
  budget: { runtimeMinutes: 0, itemsAttempted: 0, estimatedUsd: 0 }
};
fs.writeFileSync(process.env.LOOP_RUN_LOG, JSON.stringify(log));
process.stdout.write("executor complete");
`);
    spec.runner.executor = "command";
    spec.runner.command = `node ${JSON.stringify(script)}`;
    spec.runner.workingDirectory = tmp;
  });

  const outcomes = runTick({
    root,
    loopName: "command-loop",
    now: new Date("2026-07-10T12:00:00Z"),
    allowCommand: true,
    forceManual: true
  });
  assert.equal(outcomes[0].status, "ran");
  assert.equal(readData(outcomes[0].runFile).status, "passed");
  assert.match(fs.readFileSync(path.join(outcomes[0].runDir, "stdout.log"), "utf8"), /executor complete/);
  assert.equal(readData(path.join(loopDir, "state.json")).budgets.runsToday, 1);
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
