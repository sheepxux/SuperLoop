import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../src/cli.js";
import { readData } from "../src/fs-utils.js";
import { validateLoopSpec } from "../src/validation.js";

const example = readData("examples/ci-triage/loop.yaml");

test("valid example loop passes validation", () => {
  const result = validateLoopSpec(example, "ci-triage");
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("worker cannot self-approve", () => {
  const spec = structuredClone(example);
  spec.verification.evaluator = spec.handoff.worker;
  const result = validateLoopSpec(spec, "bad-loop");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /independent/);
});

test("high-risk permission requires human-only gate", () => {
  const spec = structuredClone(example);
  spec.handoff.permissions.push("merge");
  spec.safety.humanGates.humanOnly = spec.safety.humanGates.humanOnly.filter((gate) => {
    return !gate.includes("merge");
  });
  const result = validateLoopSpec(spec, "bad-loop");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /high-risk permission "merge"/);
});

test("init creates durable loop state", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-init-"));
  await main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp]);

  const loopDir = path.join(tmp, "ci-triage");
  assert.equal(fs.existsSync(path.join(loopDir, "loop.yaml")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "state.json")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "inbox.md")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "decisions.md")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "runs")), true);
});

test("init normalizes template branch prefix to loop name", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-init-template-"));
  await main(["init", "nightly-docs", "--from", "templates/loop.yaml", "--out", tmp]);
  const spec = readData(path.join(tmp, "nightly-docs", "loop.yaml"));
  assert.equal(spec.handoff.worktree.branchPrefix, "loop-engineering/nightly-docs");
});

test("render creates codex and claude-code adapter files", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-render-"));
  await main(["render", "codex", "examples/ci-triage/loop.yaml", "--out", tmp]);
  await main(["render", "claude-code", "examples/ci-triage/loop.yaml", "--out", tmp]);

  assert.equal(fs.existsSync(path.join(tmp, "codex", "loop-engineering", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "skills", "ci-triage", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "agents", "ci-fix-generator.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "agents", "ci-fix-evaluator.md")), true);
});

test("render creates every supported adapter", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-all-renderers-"));
  for (const adapter of ["codex", "claude-code", "chatgpt", "openclaw", "generic-harness", "github-actions"]) {
    await main(["render", adapter, "examples/ci-triage/loop.yaml", "--out", tmp]);
  }

  assert.equal(fs.existsSync(path.join(tmp, "codex", "loop-engineering", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "skills", "ci-triage", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "chatgpt", "ci-triage", "instructions.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "openclaw", "ci-triage", "loop-instructions.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "generic-harness", "ci-triage", "loop-contract.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".github", "workflows", "ci-triage.yml")), true);
});

test("github-actions renderer validates loop spec, not state file", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-gh-"));
  await main(["render", "github-actions", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const workflow = fs.readFileSync(path.join(tmp, ".github", "workflows", "ci-triage.yml"), "utf8");
  assert.match(workflow, /loopctl validate \.loop-engineering\/loops\/ci-triage\/loop\.yaml/);
  assert.doesNotMatch(workflow, /loopctl validate .*state\.json/);
  assert.equal(fs.existsSync(path.join(tmp, ".loop-engineering", "loops", "ci-triage", "loop.yaml")), true);
});

test("doctor reports publish readiness", async () => {
  const priorExitCode = process.exitCode;
  process.exitCode = undefined;
  await main(["doctor"]);
  assert.equal(process.exitCode, undefined);
  process.exitCode = priorExitCode;
});
