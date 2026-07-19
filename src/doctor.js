import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { readData, readText, repoRoot, schemaPath } from "./fs-utils.js";
import { staticAdapterFiles } from "./skill-content.js";
import { validateSkillPackage } from "./skill-package.js";
import { validateLoopFile } from "./validation.js";
import { validateProposalFile } from "./proposal.js";

const REQUIRED_FILES = [
  "README.md",
  "README.en.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  "docs/canonical-json.md",
  ".github/workflows/ci.yml",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/pull_request_template.md",
  ".codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  "package.json",
  "bin/loopctl.js",
  "bin/loopd.js",
  "src/daemon-cli.js",
  "src/lease.js",
  "src/runner.js",
  "protocol/loop.schema.json",
  "protocol/state.schema.json",
  "protocol/evaluator.schema.json",
  "protocol/goal-evaluation.schema.json",
  "protocol/run-log.schema.json",
  "protocol/strategy.schema.json",
  "protocol/experiment.schema.json",
  "protocol/approval.schema.json",
  "protocol/decision.schema.json",
  "protocol/proposal.schema.json",
  "protocol/proposal-decision.schema.json",
  "templates/proposal.yaml",
  "templates/proposal-decision.json",
  "templates/goal-evaluation.json",
  "templates/loop.yaml",
  "templates/state.json",
  "templates/strategy.json",
  "templates/experiment.json",
  "templates/approval.json",
  "templates/decision.json",
  "skills/superloop/SKILL.md",
  "skills/superloop/agents/openai.yaml",
  "skills/superloop/references/suitability-and-patterns.md",
  "skills/superloop/references/idea-to-loop.md",
  "skills/superloop/references/work-plans.md",
  "skills/superloop/references/contract-design.md",
  "skills/superloop/references/execution-and-evaluation.md",
  "skills/superloop/references/runtime-integrations.md",
  "skills/superloop/references/strategy-evolution.md",
  "skills/superloop/references/safety-and-governance.md",
  "skills/superloop/references/troubleshooting.md",
  "skills/superloop/scripts/run-loopctl.mjs",
  "skills/superloop/assets/loop.yaml",
  "skills/superloop/assets/proposal.yaml",
  "skills/superloop/assets/proposal-decision.json",
  "skills/superloop/assets/goal-evaluation.json",
  "skills/superloop/assets/decision.json",
  "skills/superloop/assets/icon-small.png",
  "skills/superloop/assets/icon-large.png",
  "skills/superloop/evals/evals.json",
  "skills/superloop/evals/results-v2.0.0.json",
  "scripts/package-smoke.js",
  "adapters/chatgpt/SKILL.md",
  "adapters/openclaw/loop-instructions.md",
  "adapters/generic-harness/loop-instructions.md",
  "examples/ci-triage/loop.yaml",
  "examples/dependency-update/loop.yaml",
  "examples/frontend-qa/loop.yaml",
  "examples/finite-project/loop.yaml",
  "examples/idea-to-loop/finite-project.proposal.yaml",
  "examples/self-improving-development/loop.yaml",
  "examples/idea-to-loop/research-monitor.proposal.yaml",
  "examples/idea-to-loop/log-cleanup.proposal.yaml"
];

const EXAMPLE_FILES = [
  "templates/loop.yaml",
  "examples/ci-triage/loop.yaml",
  "examples/dependency-update/loop.yaml",
  "examples/frontend-qa/loop.yaml",
  "examples/finite-project/loop.yaml",
  "examples/self-improving-development/loop.yaml"
];

const PROPOSAL_EXAMPLE_FILES = [
  "templates/proposal.yaml",
  "examples/idea-to-loop/research-monitor.proposal.yaml",
  "examples/idea-to-loop/log-cleanup.proposal.yaml"
];

const TEMPLATE_DATA_FILES = [
  ["proposal", "templates/proposal.yaml"],
  ["proposal-decision", "templates/proposal-decision.json"],
  ["state", "templates/state.json"],
  ["evaluator", "templates/evaluator-result.json"],
  ["goal-evaluation", "templates/goal-evaluation.json"],
  ["run-log", "templates/run-log.json"],
  ["strategy", "templates/strategy.json"],
  ["experiment", "templates/experiment.json"],
  ["approval", "templates/approval.json"],
  ["decision", "templates/decision.json"]
];

export function runDoctor({ root = repoRoot } = {}) {
  const checks = [];
  for (const [label, checker] of [
    ["Node.js version", checkNodeVersion],
    ["required files", checkRequiredFiles],
    ["package metadata", checkPackageMetadata],
    ["distribution versions", checkDistributionVersions],
    ["canonical Skill", checkCanonicalSkill],
    ["schemas", checkSchemasParse],
    ["Loop examples", checkLoopSpecsValidate],
    ["proposal examples", checkProposalSpecsValidate],
    ["template data", checkTemplateDataValidate],
    ["Skill assets", checkSkillAssetsInSync],
    ["generated adapters", checkAdaptersInSync]
  ]) {
    try {
      checker(checks, root);
    } catch (error) {
      checks.push({ ok: false, message: `${label} check could not complete (${error.message})` });
    }
  }

  for (const check of checks) {
    const prefix = check.ok ? "OK" : "FAIL";
    console.log(`${prefix} ${check.message}`);
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    checks,
    failed
  };
}

function checkNodeVersion(checks) {
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    ok: major >= 20,
    message: `Node.js version is ${process.versions.node}; expected >=20`
  });
}

function checkRequiredFiles(checks, root = repoRoot) {
  for (const file of REQUIRED_FILES) {
    checks.push({
      ok: fs.existsSync(path.join(root, file)),
      message: `required file exists: ${file}`
    });
  }
}

function checkPackageMetadata(checks, root = repoRoot) {
  const pkg = readData(path.join(root, "package.json"));
  checks.push({
    ok: pkg.name === "@sheepxux/superloop",
    message: "package name is @sheepxux/superloop"
  });
  checks.push({ ok: Boolean(pkg.version), message: "package version is set" });
  checks.push({ ok: pkg.author === "sheepxux", message: "package author is sheepxux" });
  checks.push({ ok: pkg.license === "MIT", message: "package license is MIT" });
  checks.push({ ok: pkg.publishConfig?.access === "public", message: "scoped package publishes publicly" });
  checks.push({ ok: pkg.bin?.loopctl === "bin/loopctl.js", message: "loopctl bin is configured" });
  checks.push({ ok: pkg.bin?.loopd === "bin/loopd.js", message: "loopd bin is configured" });
  checks.push({ ok: Array.isArray(pkg.files) && pkg.files.includes("protocol/"), message: "npm files include protocol/" });
  checks.push({ ok: Array.isArray(pkg.files) && pkg.files.includes("skills/"), message: "npm files include canonical skills/" });
  checks.push({ ok: Array.isArray(pkg.files) && pkg.files.includes(".codex-plugin/"), message: "npm files include Codex plugin manifest" });
  checks.push({ ok: Array.isArray(pkg.files) && pkg.files.includes(".claude-plugin/"), message: "npm files include Claude plugin manifest" });
  checks.push({ ok: Array.isArray(pkg.files) && pkg.files.includes("README.en.md"), message: "npm files include English README" });
  checks.push({ ok: Array.isArray(pkg.files) && pkg.files.includes("CHANGELOG.md"), message: "npm files include changelog" });
  checks.push({ ok: Boolean(pkg.repository?.url), message: "package repository URL is set" });
}

function checkDistributionVersions(checks, root = repoRoot) {
  const pkg = readData(path.join(root, "package.json"));
  const codex = readData(path.join(root, ".codex-plugin", "plugin.json"));
  const claude = readData(path.join(root, ".claude-plugin", "plugin.json"));
  const marketplace = readData(path.join(root, ".claude-plugin", "marketplace.json"));
  const evalResults = readData(path.join(root, "skills", "superloop", "evals", `results-v${pkg.version}.json`));
  for (const [name, version] of [
    ["Codex plugin", codex.version],
    ["Claude plugin", claude.version],
    ["Claude marketplace", marketplace.metadata?.version]
  ]) {
    checks.push({ ok: version === pkg.version, message: `${name} version matches package version ${pkg.version}` });
  }
  checks.push({
    ok: evalResults.version === pkg.version
      && evalResults.skill_name === "superloop"
      && ["fresh-session", "migration-review"].includes(evalResults.evidence_type),
    message: `${evalResults.evidence_type || "untyped"} Skill eval evidence matches package version ${pkg.version}`
  });
  const helper = readText(path.join(root, "skills", "superloop", "scripts", "run-loopctl.mjs"));
  checks.push({
    ok: helper.includes(`SuperLoop#v${pkg.version}`),
    message: `Skill runtime helper pins GitHub runtime v${pkg.version}`
  });
  const claudeEntry = marketplace.plugins?.find((entry) => entry.name === claude.name);
  checks.push({
    ok: claudeEntry?.strict === true,
    message: "Claude marketplace uses strict manifest loading to avoid duplicate component declarations"
  });
  for (const schema of ["loop", "state", "evaluator", "goal-evaluation", "run-log", "strategy", "experiment", "approval", "decision", "proposal", "proposal-decision"]) {
    const data = JSON.parse(readText(schemaPath(schema)));
    checks.push({
      ok: typeof data.$id === "string" && data.$id.includes(`/v${pkg.version}/`),
      message: `schema $id is pinned to v${pkg.version}: ${schema}`
    });
  }
}

function checkCanonicalSkill(checks, root = repoRoot) {
  const result = validateSkillPackage(path.join(root, "skills", "superloop"));
  checks.push({
    ok: result.ok,
    message: result.ok
      ? `canonical Skill validates (${result.lineCount} lines)`
      : `canonical Skill validates (${result.errors.join("; ")})`
  });
  for (const warning of result.warnings) {
    checks.push({ ok: true, message: `canonical Skill warning: ${warning}` });
  }
}

function checkSchemasParse(checks) {
  for (const schema of ["loop", "state", "evaluator", "goal-evaluation", "run-log", "strategy", "experiment", "approval", "decision", "proposal", "proposal-decision"]) {
    try {
      JSON.parse(readText(schemaPath(schema)));
      checks.push({ ok: true, message: `schema parses: ${schema}` });
    } catch (error) {
      checks.push({ ok: false, message: `schema parses: ${schema} (${error.message})` });
    }
  }
}

function checkLoopSpecsValidate(checks, root = repoRoot) {
  for (const file of EXAMPLE_FILES) {
    const result = validateLoopFile(path.join(root, file));
    checks.push({
      ok: result.ok,
      message: result.ok ? `loop spec validates: ${file}` : `loop spec validates: ${file} (${result.errors.join("; ")})`
    });
  }
}

function checkProposalSpecsValidate(checks, root = repoRoot) {
  for (const file of PROPOSAL_EXAMPLE_FILES) {
    const result = validateProposalFile(path.join(root, file));
    checks.push({
      ok: result.ok,
      message: result.ok ? `proposal validates: ${file}` : `proposal validates: ${file} (${result.errors.join("; ")})`
    });
  }
}

function checkTemplateDataValidate(checks, root = repoRoot) {
  for (const [schemaName, file] of TEMPLATE_DATA_FILES) {
    try {
      if (schemaName === "proposal") {
        const result = validateProposalFile(path.join(root, file));
        checks.push({
          ok: result.ok,
          message: result.ok ? `template data validates: ${file}` : `template data validates: ${file} (${result.errors.join("; ")})`
        });
        continue;
      }
      const ajv = new Ajv2020({ allErrors: true });
      if (schemaName === "experiment") {
        ajv.addSchema(JSON.parse(readText(schemaPath("strategy"))));
      }
      const validate = ajv.compile(JSON.parse(readText(schemaPath(schemaName))));
      const valid = validate(readData(path.join(root, file)));
      checks.push({
        ok: valid,
        message: valid ? `template data validates: ${file}` : `template data validates: ${file} (${formatAjvErrors(validate.errors)})`
      });
    } catch (error) {
      checks.push({ ok: false, message: `template data validates: ${file} (${error.message})` });
    }
  }
}

function checkAdaptersInSync(checks, root = repoRoot) {
  for (const [relativePath, expected] of staticAdapterFiles()) {
    const filePath = path.join(root, relativePath);
    let ok = false;
    let hint = "";
    try {
      ok = readText(filePath) === expected;
      hint = ok ? "" : " (out of date; run npm run build:adapters)";
    } catch (error) {
      hint = ` (${error.message})`;
    }
    checks.push({ ok, message: `adapter file in sync with src/skill-content.js: ${relativePath}${hint}` });
  }
}

function checkSkillAssetsInSync(checks, root = repoRoot) {
  for (const name of [
    "proposal.yaml",
    "proposal-decision.json",
    "loop.yaml",
    "state.json",
    "evaluator-result.json",
    "goal-evaluation.json",
    "run-log.json",
    "strategy.json",
    "experiment.json",
    "approval.json",
    "decision.json"
  ]) {
    const skillAsset = path.join(root, "skills", "superloop", "assets", name);
    const compatibilityTemplate = path.join(root, "templates", name);
    const ok = fs.existsSync(skillAsset) && fs.existsSync(compatibilityTemplate) && readText(skillAsset) === readText(compatibilityTemplate);
    checks.push({
      ok,
      message: `Skill asset is canonical and templates mirror is in sync: ${name}${ok ? "" : " (run npm run build:assets)"}`
    });
  }
}

function formatAjvErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}
