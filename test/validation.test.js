import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../src/cli.js";
import { runDoctor } from "../src/doctor.js";
import { readData } from "../src/fs-utils.js";
import { chatgptSkill, evaluatorPrompt, workerPrompt } from "../src/skill-content.js";
import { validateSkillPackage } from "../src/skill-package.js";
import { validateLoopSpec } from "../src/validation.js";

const example = readData("examples/ci-triage/loop.yaml");
const packageVersion = readData("package.json").version;

function copyCanonicalSkill(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const skillDir = path.join(tmp, "superloop");
  fs.cpSync("skills/superloop", skillDir, { recursive: true });
  return { tmp, skillDir };
}

function mutateEvalResults(skillDir, mutate) {
  const file = path.join(skillDir, "evals", `results-v${packageVersion}.json`);
  const data = readData(file);
  mutate(data);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

test("valid example loop passes validation", () => {
  const result = validateLoopSpec(example, "ci-triage");
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("worker prompts honor non-worktree isolation modes", () => {
  const spec = readData("examples/finite-project/loop.yaml");
  const prompt = workerPrompt(spec);
  assert.match(prompt, /Mode: task-directory/);
  assert.match(prompt, /caller-provided isolated task directory/);
  assert.doesNotMatch(prompt, /git worktree add/);
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

test("external pull request output remains human-only", () => {
  const spec = structuredClone(example);
  spec.safety.humanGates.humanOnly = spec.safety.humanGates.humanOnly.filter((gate) => gate !== "open-pull-request");
  spec.safety.humanGates.needsReview.push("open-pull-request");
  const result = validateLoopSpec(spec, "unsafe-external-output");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /open-pr.*humanOnly|pull-request.*humanOnly/);
});

test("verification verdict list must contain each protocol verdict exactly once", () => {
  const spec = structuredClone(example);
  spec.verification.verdicts = ["fail", "fail", "fail", "fail"];
  const result = validateLoopSpec(spec, "duplicate-verdicts");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /duplicate items/);
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-init-"));
  await main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp]);

  const loopDir = path.join(tmp, "ci-triage");
  assert.equal(fs.existsSync(path.join(loopDir, "loop.yaml")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "state.json")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "inbox.md")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "decisions.md")), true);
  assert.equal(fs.existsSync(path.join(loopDir, "runs")), true);
});

test("init normalizes template branch prefix to loop name", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-init-template-"));
  await main(["init", "nightly-docs", "--from", "templates/loop.yaml", "--out", tmp]);
  const spec = readData(path.join(tmp, "nightly-docs", "loop.yaml"));
  assert.equal(spec.handoff.worktree.branchPrefix, "superloop/nightly-docs");
});

test("init force replaces the complete prior loop directory", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-init-force-"));
  await main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const loopDir = path.join(tmp, "ci-triage");
  const stale = path.join(loopDir, "runs", "stale.json");
  fs.writeFileSync(stale, "{}\n");

  await main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp, "--force"]);
  assert.equal(fs.existsSync(stale), false);
  assert.deepEqual(fs.readdirSync(path.join(loopDir, "runs")), []);
  assert.equal(readData(path.join(loopDir, "state.json")).budgets.runsToday, 0);
});

test("init force fails closed while any loop coordination artifact exists", async (t) => {
  const blockers = [
    { relative: path.join("locks", "active-run.json"), directory: false },
    { relative: path.join("locks", "state-update.lock"), directory: true },
    { relative: path.join("locks", "state-transaction.json"), directory: false }
  ];

  for (const blocker of blockers) {
    await t.test(blocker.relative, async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-init-force-lock-"));
      await main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp]);
      const loopDir = path.join(tmp, "ci-triage");
      const marker = path.join(loopDir, "preserve-me.txt");
      const blockedPath = path.join(loopDir, blocker.relative);
      fs.writeFileSync(marker, "preserved\n");
      fs.mkdirSync(path.dirname(blockedPath), { recursive: true });
      if (blocker.directory) {
        fs.mkdirSync(blockedPath);
      } else {
        fs.writeFileSync(blockedPath, "malformed coordination data\n");
      }

      await assert.rejects(
        main(["init", "ci-triage", "--from", "examples/ci-triage/loop.yaml", "--out", tmp, "--force"]),
        /Refusing to force-replace.*coordination artifact exists/
      );
      assert.equal(fs.readFileSync(marker, "utf8"), "preserved\n");
      assert.equal(fs.lstatSync(blockedPath).isDirectory(), blocker.directory);
    });
  }
});

test("render creates codex and claude-code adapter files", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-render-"));
  await main(["render", "codex", "examples/ci-triage/loop.yaml", "--out", tmp]);
  await main(["render", "claude-code", "examples/ci-triage/loop.yaml", "--out", tmp]);

  assert.equal(fs.existsSync(path.join(tmp, ".agents", "skills", "ci-triage", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".agents", "skills", "ci-triage", "agents", "openai.yaml")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "skills", "ci-triage", "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "agents", "ci-fix-generator.md")), true);
  assert.equal(fs.existsSync(path.join(tmp, ".claude", "agents", "ci-fix-evaluator.md")), true);
});

test("render creates every supported adapter", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-all-renderers-"));
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

test("rendered worker, evaluator, and advisor retain the complete approved Goal Contract", () => {
  const spec = structuredClone(example);
  spec.goalContract = {
    objective: {
      id: "goal-ci-health",
      statement: spec.goal.objective,
      outcome: "Reproducible CI failures become independently verified local fixes.",
      measurement: "Verified CI-fix pass rate per bounded run."
    },
    acceptanceCriteria: spec.goal.acceptanceCriteria.map((statement, index) => ({
      id: `ac-ci-${index + 1}`,
      statement,
      evidence: [spec.verification.requiredEvidence[index % spec.verification.requiredEvidence.length]],
      passCondition: `Criterion ${index + 1} has the required independent evidence and no regression.`
    })),
    nonGoals: [{ id: "non-goal-merge", condition: "Do not merge or deploy the generated fix." }],
    stopConditions: spec.goal.stopConditions.map((condition, index) => ({ id: `stop-ci-${index + 1}`, condition })),
    blockedConditions: spec.goal.blockedConditions.map((condition, index) => ({ id: `blocked-ci-${index + 1}`, condition }))
  };
  assert.equal(validateLoopSpec(spec).ok, true);

  for (const output of [workerPrompt(spec), evaluatorPrompt(spec), chatgptSkill(spec)]) {
    assert.match(output, /Reproducible CI failures become independently verified local fixes/);
    assert.match(output, /Criterion 1 has the required independent evidence/);
    assert.match(output, /Do not merge or deploy the generated fix/);
    assert.match(output, new RegExp(spec.goal.stopConditions[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(output, new RegExp(spec.goal.blockedConditions[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("github-actions scaffold validates loop spec, not state file", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-gh-"));
  await main(["render", "github-actions-scaffold", "examples/ci-triage/loop.yaml", "--out", tmp]);
  const workflow = fs.readFileSync(path.join(tmp, ".github", "workflows", "ci-triage.yml"), "utf8");
  assert.match(workflow, /loopctl validate '\.superloop\/loops\/ci-triage\/loop\.yaml'/);
  assert.match(workflow, /actions\/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6/);
  assert.match(workflow, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/);
  assert.doesNotMatch(workflow, /loopctl validate .*state\.json/);
  assert.equal(fs.existsSync(path.join(tmp, ".superloop", "loops", "ci-triage", "loop.yaml")), true);
});

test("doctor reports publish readiness", async () => {
  const priorExitCode = process.exitCode;
  process.exitCode = undefined;
  await main(["doctor"]);
  assert.equal(process.exitCode, undefined);
  process.exitCode = priorExitCode;
});

test("doctor fails closed without throwing when release artifacts are missing", () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-empty-doctor-"));
  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = runDoctor({ root: emptyRoot });
  } finally {
    console.log = originalLog;
  }
  assert.equal(result.ok, false);
  assert.match(result.failed.map((check) => check.message).join("\n"), /distribution versions check could not complete/);
  assert.match(result.failed.map((check) => check.message).join("\n"), /required file exists: package\.json/);
});

test("canonical Skill validates and installs for Codex and Claude Code", async () => {
  const validation = validateSkillPackage("skills/superloop");
  assert.equal(validation.ok, true, validation.errors.join("\n"));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-install-skill-"));
  await main(["skill", "install", "both", "--out", tmp]);
  const codex = path.join(tmp, "codex", "superloop");
  const claude = path.join(tmp, "claude-code", "superloop");
  assert.equal(validateSkillPackage(codex).ok, true);
  assert.equal(validateSkillPackage(claude).ok, true);
  await assert.rejects(() => main(["skill", "install", "codex", "--out", tmp]), /overwrite existing Skill/);
});

test("Skill validation accepts GitHub CLI source and pin metadata on an installed copy", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-github-skill-"));
  const installed = path.join(tmp, "superloop");
  fs.cpSync("skills/superloop", installed, { recursive: true });
  const skillFile = path.join(installed, "SKILL.md");
  const source = fs.readFileSync(skillFile, "utf8");
  const frontmatterEnd = source.indexOf("\n---", 4);
  const tracking = [
    "metadata:",
    "  github-path: skills/superloop",
    "  github-pinned: v2.0.0",
    "  github-ref: refs/tags/v2.0.0",
    "  github-repo: https://github.com/sheepxux/SuperLoop",
    "  github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
  ].join("\n");
  fs.writeFileSync(skillFile, `${source.slice(0, frontmatterEnd)}\n${tracking}${source.slice(frontmatterEnd)}`);

  const validation = validateSkillPackage(installed);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
});

test("Skill eval validation binds release evidence to the package version and definitions", () => {
  const stale = copyCanonicalSkill("superloop-stale-evals-");
  fs.renameSync(
    path.join(stale.skillDir, "evals", `results-v${packageVersion}.json`),
    path.join(stale.skillDir, "evals", "results-v0.0.0.json")
  );
  let validation = validateSkillPackage(stale.skillDir);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /package version/);

  const mismatched = copyCanonicalSkill("superloop-mismatched-evals-");
  mutateEvalResults(mismatched.skillDir, (data) => {
    data.version = "0.0.0";
  });
  validation = validateSkillPackage(mismatched.skillDir);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /version must match package version/);

  const forged = copyCanonicalSkill("superloop-forged-evals-");
  mutateEvalResults(forged.skillDir, (data) => {
    data.results[0].expectations_passed = -1;
    data.results[1].expectations_passed = 1;
    data.results[1].expectations_total = 1;
  });
  validation = validateSkillPackage(forged.skillDir);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /every defined expectation/);
});

test("Skill eval validation requires complete unique sessions and an exact summary", () => {
  const copy = copyCanonicalSkill("superloop-session-evals-");
  mutateEvalResults(copy.skillDir, (data) => {
    data.sessions[1].id = data.sessions[0].id;
    data.results[0].session = "undeclared-session";
    data.summary.passed -= 1;
  });

  const validation = validateSkillPackage(copy.skillDir);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /session IDs must be unique/);
  assert.match(validation.errors.join("\n"), /must reference a declared evidence session ID/);
  assert.match(validation.errors.join("\n"), /summary does not exactly match/);
});

test("Skill eval session review records are digest-bound and expectation-complete", () => {
  const copy = copyCanonicalSkill("superloop-session-artifact-");
  const resultFile = path.join(copy.skillDir, "evals", `results-v${packageVersion}.json`);
  const results = readData(resultFile);
  const session = results.sessions[0];
  const artifact = path.resolve(copy.skillDir, session.artifact);
  const record = readData(artifact);
  record.evaluations[0].judgments[0].passed = false;
  fs.writeFileSync(artifact, `${JSON.stringify(record, null, 2)}\n`);

  const validation = validateSkillPackage(copy.skillDir);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /SHA-256 does not match/);
});

test("Skill eval sessions retain digest-bound raw evidence output", () => {
  const copy = copyCanonicalSkill("superloop-raw-session-artifact-");
  const resultFile = path.join(copy.skillDir, "evals", `results-v${packageVersion}.json`);
  const results = readData(resultFile);
  const session = results.sessions[0];
  const rawArtifact = path.resolve(copy.skillDir, session.raw_artifact);
  fs.appendFileSync(rawArtifact, "\nforged output\n");

  const validation = validateSkillPackage(copy.skillDir);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /raw artifact SHA-256 does not match/);
});

test("Skill eval fixtures must be regular files with real paths inside the Skill", () => {
  const escaped = copyCanonicalSkill("superloop-escaped-fixture-");
  const escapedFixture = path.join(escaped.skillDir, "evals", "fixtures", "unsafe-loop.yaml");
  const outside = path.join(escaped.tmp, "outside-loop.yaml");
  fs.writeFileSync(outside, "outside: true\n");
  fs.rmSync(escapedFixture);
  fs.symlinkSync(outside, escapedFixture);
  let validation = validateSkillPackage(escaped.skillDir);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /regular file inside the Skill directory/);

  const directory = copyCanonicalSkill("superloop-directory-fixture-");
  const directoryFixture = path.join(directory.skillDir, "evals", "fixtures", "unsafe-loop.yaml");
  fs.rmSync(directoryFixture);
  fs.mkdirSync(directoryFixture);
  validation = validateSkillPackage(directory.skillDir);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /regular file inside the Skill directory/);
});
