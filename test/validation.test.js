import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../src/cli.js";
import { readData } from "../src/fs-utils.js";
import { validateSkillPackage } from "../src/skill-package.js";
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

test("human gates require exact typed action IDs instead of substring matches", () => {
  const spec = structuredClone(example);
  spec.handoff.permissions.push("merge");
  spec.safety.humanGates.humanOnly = spec.safety.humanGates.humanOnly
    .filter((gate) => gate !== "merge-pull-request")
    .concat("not-merge-pull-request");
  const result = validateLoopSpec(spec, "substring-gate");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /high-risk permission "merge"/);
});

test("persistence and runner paths cannot escape the loop repository", () => {
  const spec = structuredClone(example);
  spec.persistence.statePath = "../outside/state.json";
  spec.runner = { executor: "dry-run", workingDirectory: "../../tmp", pollSeconds: 30 };
  const result = validateLoopSpec(spec, "path-traversal");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /safe repository-relative path|safe relative path/);
});

test("action IDs cannot appear in multiple gate levels", () => {
  const spec = structuredClone(example);
  spec.safety.humanGates.needsReview.push(spec.safety.humanGates.autoAllowed[0]);
  const result = validateLoopSpec(spec, "duplicate-gate");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unique across/);
});

test("automatic strategy promotion is rejected for non-low-risk loops", () => {
  const spec = readData("examples/self-improving-development/loop.yaml");
  spec.evolution.promotion.mode = "automatic";
  const result = validateLoopSpec(spec, "unsafe-evolution");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /automatic strategy promotion.*low-risk/);
});

test("strategy evaluator must be independent from task agents", () => {
  const spec = readData("examples/self-improving-development/loop.yaml");
  spec.evolution.evaluator.name = spec.verification.evaluator;
  const result = validateLoopSpec(spec, "coupled-evolution");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /evolution\.evaluator\.name must be independent/);
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

  assert.equal(fs.existsSync(path.join(tmp, ".agents", "skills", "ci-triage", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".agents", "skills", "ci-triage", "agents", "openai.yaml")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "skills", "ci-triage", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "agents", "ci-fix-generator.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "agents", "ci-fix-evaluator.md")), true);
});

test("render creates every supported adapter", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-all-renderers-"));
  for (const adapter of ["codex", "claude-code", "chatgpt", "openclaw", "generic-harness", "github-actions-scaffold"]) {
    await main(["render", adapter, "examples/ci-triage/loop.yaml", "--out", tmp]);
  }

  assert.equal(fs.existsSync(path.join(tmp, ".agents", "skills", "ci-triage", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "skills", "ci-triage", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "chatgpt", "ci-triage", "instructions.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "openclaw", "ci-triage", "loop-instructions.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, "generic-harness", "ci-triage", "loop-contract.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".github", "workflows", "ci-triage.yml")), true);
});

test("github-actions scaffold validates loop spec, not state file", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-gh-"));
  await main(["render", "github-actions-scaffold", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const workflow = fs.readFileSync(path.join(tmp, ".github", "workflows", "ci-triage.yml"), "utf8");
  assert.match(workflow, /loopctl validate '\.loop-engineering\/loops\/ci-triage\/loop\.yaml'/);
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

test("canonical Skill validates and installs for Codex and Claude Code", async () => {
  const validation = validateSkillPackage("skills/loop-engineering");
  assert.equal(validation.ok, true, validation.errors.join("\n"));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-install-skill-"));
  await main(["skill", "install", "both", "--out", tmp]);
  const codex = path.join(tmp, "codex", "loop-engineering");
  const claude = path.join(tmp, "claude-code", "loop-engineering");
  assert.equal(validateSkillPackage(codex).ok, true);
  assert.equal(validateSkillPackage(claude).ok, true);
  await assert.rejects(() => main(["skill", "install", "codex", "--out", tmp]), /overwrite existing Skill/);
});

test("Skill validation accepts GitHub CLI source metadata on an installed copy", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-github-skill-"));
  const installed = path.join(tmp, "loop-engineering");
  fs.cpSync("skills/loop-engineering", installed, { recursive: true });
  const skillFile = path.join(installed, "SKILL.md");
  const source = fs.readFileSync(skillFile, "utf8");
  const frontmatterEnd = source.indexOf("\n---", 4);
  const tracking = [
    "metadata:",
    "  github-path: skills/loop-engineering",
    "  github-ref: refs/tags/v1.0.1",
    "  github-repo: https://github.com/sheepxux/Loop-Engineering",
    "  github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
  ].join("\n");
  fs.writeFileSync(skillFile, `${source.slice(0, frontmatterEnd)}\n${tracking}${source.slice(frontmatterEnd)}`);

  const validation = validateSkillPackage(installed);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
});
