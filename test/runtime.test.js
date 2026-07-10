import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../src/cli.js";
import { readData, writeJson } from "../src/fs-utils.js";
import { nextRun, recordRun, resolveLoop } from "../src/loop-state.js";

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

test("next reports full budget for a fresh loop", async () => {
  const loopDir = await initLoop();
  const plan = nextRun(resolveLoop(loopDir));

  assert.equal(plan.ok, true);
  assert.equal(plan.itemsAllowed, 3);
  assert.equal(plan.budget.runsRemainingToday, 2);
  assert.deepEqual(plan.retryQueue, []);
});

test("record files the run log and updates state budgets and items", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  const now = new Date("2026-07-10T02:00:00Z");
  const outcome = recordRun(loop, runLog(), { now });

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
  const now = new Date("2026-07-10T02:00:00Z");
  const failing = { itemId: "run-102", verdict: "fail", summary: "did not compile" };

  recordRun(resolveLoop(loopDir), runLog({ results: [failing], discovered: [] }), { now });
  recordRun(
    resolveLoop(loopDir),
    runLog({ runId: "2026-07-10T0200Z", results: [failing], discovered: [] }),
    { now }
  );

  const state = readData(path.join(loopDir, "state.json"));
  assert.deepEqual(state.items, [
    { id: "run-102", status: "failed", retries: 1, summary: "did not compile" }
  ]);

  const plan = nextRun(resolveLoop(loopDir), now);
  assert.equal(plan.ok, false);
  assert.match(plan.reasons.join("\n"), /Daily run budget exhausted/);
  assert.deepEqual(plan.retryQueue, [{ id: "run-102", status: "failed", retries: 1 }]);
});

test("next resets daily budgets on UTC day rollover", async () => {
  const loopDir = await initLoop();
  const runDay = new Date("2026-07-10T02:00:00Z");
  recordRun(resolveLoop(loopDir), runLog(), { now: runDay });
  recordRun(resolveLoop(loopDir), runLog({ runId: "2026-07-10T0200Z" }), { now: runDay });

  const sameDay = nextRun(resolveLoop(loopDir), runDay);
  assert.equal(sameDay.ok, false);

  const nextDay = nextRun(resolveLoop(loopDir), new Date("2026-07-11T02:00:00Z"));
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.budget.dayRolledOver, true);
  assert.equal(nextDay.budget.runsToday, 0);
});

test("next flags items with exhausted retries", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);
  writeJson(path.join(loopDir, "state.json"), {
    apiVersion: "loop-engineering/v1",
    loop: "ci-triage",
    lastRunAt: "2026-07-10T01:00:00Z",
    items: [{ id: "run-103", status: "failed", retries: 3 }],
    budgets: { runsToday: 0, runtimeMinutesToday: 0, estimatedUsdToday: 0 }
  });

  const plan = nextRun(loop, new Date("2026-07-10T02:00:00Z"));
  assert.deepEqual(plan.exhausted, [{ id: "run-103", retries: 3, action: "move-to-inbox" }]);
  assert.deepEqual(plan.retryQueue, []);
});

test("record rejects run logs that violate the schema or the spec", async () => {
  const loopDir = await initLoop();
  const loop = resolveLoop(loopDir);

  assert.throws(() => recordRun(loop, runLog({ status: "nope" })), /run-log\.schema\.json/);
  assert.throws(() => recordRun(loop, runLog({ loop: "other-loop" })), /does not match spec loop/);

  const tooMany = Array.from({ length: 4 }, (_, index) => ({
    itemId: `run-${index}`,
    verdict: "pass"
  }));
  assert.throws(() => recordRun(loop, runLog({ results: tooMany })), /maxItemsPerRun/);
});

test("record refuses to overwrite an existing run log without force", async () => {
  const loopDir = await initLoop();
  const now = new Date("2026-07-10T02:00:00Z");
  recordRun(resolveLoop(loopDir), runLog(), { now });
  assert.throws(() => recordRun(resolveLoop(loopDir), runLog(), { now }), /--force/);
  recordRun(resolveLoop(loopDir), runLog(), { now, force: true });
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
  const skill = fs.readFileSync(path.join(tmp, "codex", "loop-engineering", "SKILL.md"), "utf8");

  assert.match(skill, /loopctl next \.loop-engineering\/loops\/ci-triage/);
  assert.match(skill, /loopctl record \.loop-engineering\/loops\/ci-triage --run/);
  assert.match(skill, /git worktree add/);
  assert.match(skill, /loopctl check evaluator/);
  assert.match(skill, /gh run list --status failure/);
});

test("rendered chatgpt adapter is an advisor, not an executor", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-chatgpt-"));
  await main(["render", "chatgpt", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const instructions = fs.readFileSync(path.join(tmp, "chatgpt", "ci-triage", "instructions.md"), "utf8");

  assert.match(instructions, /cannot execute this loop/);
  assert.doesNotMatch(instructions, /git worktree/);
});

test("github-actions workflow gates the run on loopctl next", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-gha-"));
  await main(["render", "github-actions", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const workflow = fs.readFileSync(path.join(tmp, ".github", "workflows", "ci-triage.yml"), "utf8");

  assert.match(workflow, /loopctl next \.loop-engineering\/loops\/ci-triage/);
  assert.match(workflow, /if: steps\.next\.outputs\.ok == 'true'/);
});
