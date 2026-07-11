import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { readData, readText, repoRoot, schemaPath } from "./fs-utils.js";
import { staticAdapterFiles } from "./skill-content.js";
import { validateSkillPackage } from "./skill-package.js";
import { validateLoopFile } from "./validation.js";

const REQUIRED_FILES = [
  "README.md",
  "README.en.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
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
  "protocol/run-log.schema.json",
  "protocol/strategy.schema.json",
  "protocol/experiment.schema.json",
  "protocol/approval.schema.json",
  "templates/loop.yaml",
  "templates/state.json",
  "templates/strategy.json",
  "templates/experiment.json",
  "templates/approval.json",
  "skills/loop-engineering/SKILL.md",
  "skills/loop-engineering/agents/openai.yaml",
  "skills/loop-engineering/references/suitability-and-patterns.md",
  "skills/loop-engineering/references/contract-design.md",
  "skills/loop-engineering/references/execution-and-evaluation.md",
  "skills/loop-engineering/references/runtime-integrations.md",
  "skills/loop-engineering/references/strategy-evolution.md",
  "skills/loop-engineering/references/safety-and-governance.md",
  "skills/loop-engineering/references/troubleshooting.md",
  "skills/loop-engineering/scripts/run-loopctl.mjs",
  "skills/loop-engineering/assets/loop.yaml",
  "skills/loop-engineering/evals/evals.json",
  "adapters/chatgpt/SKILL.md",
  "adapters/openclaw/loop-instructions.md",
  "adapters/generic-harness/loop-instructions.md",
  "examples/ci-triage/loop.yaml",
  "examples/dependency-update/loop.yaml",
  "examples/frontend-qa/loop.yaml",
  "examples/self-improving-development/loop.yaml"
];

const EXAMPLE_FILES = [
  "templates/loop.yaml",
  "examples/ci-triage/loop.yaml",
  "examples/dependency-update/loop.yaml",
  "examples/frontend-qa/loop.yaml",
  "examples/self-improving-development/loop.yaml"
];

const TEMPLATE_DATA_FILES = [
  ["state", "templates/state.json"],
  ["evaluator", "templates/evaluator-result.json"],
  ["run-log", "templates/run-log.json"],
  ["strategy", "templates/strategy.json"],
  ["experiment", "templates/experiment.json"]
  , ["approval", "templates/approval.json"]
];

export function runDoctor() {
  const checks = [];
  checkNodeVersion(checks);
  checkRequiredFiles(checks);
  checkPackageMetadata(checks);
  checkDistributionVersions(checks);
  checkCanonicalSkill(checks);
  checkSchemasParse(checks);
  checkLoopSpecsValidate(checks);
  checkTemplateDataValidate(checks);
  checkSkillAssetsInSync(checks);
  checkAdaptersInSync(checks);

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

function checkRequiredFiles(checks) {
  for (const file of REQUIRED_FILES) {
    checks.push({
      ok: fs.existsSync(path.join(repoRoot, file)),
      message: `required file exists: ${file}`
    });
  }
}

function checkPackageMetadata(checks) {
  const pkg = readData(path.join(repoRoot, "package.json"));
  checks.push({
    ok: pkg.name === "@sheepxux/loop-engineering",
    message: "package name is @sheepxux/loop-engineering"
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
  checks.push({ ok: Boolean(pkg.repository?.url), message: "package repository URL is set" });
}

function checkDistributionVersions(checks) {
  const pkg = readData(path.join(repoRoot, "package.json"));
  const codex = readData(path.join(repoRoot, ".codex-plugin", "plugin.json"));
  const claude = readData(path.join(repoRoot, ".claude-plugin", "plugin.json"));
  const marketplace = readData(path.join(repoRoot, ".claude-plugin", "marketplace.json"));
  for (const [name, version] of [
    ["Codex plugin", codex.version],
    ["Claude plugin", claude.version],
    ["Claude marketplace", marketplace.metadata?.version]
  ]) {
    checks.push({ ok: version === pkg.version, message: `${name} version matches package version ${pkg.version}` });
  }
  const claudeEntry = marketplace.plugins?.find((entry) => entry.name === claude.name);
  checks.push({
    ok: claudeEntry?.strict === true,
    message: "Claude marketplace uses strict manifest loading to avoid duplicate component declarations"
  });
  for (const schema of ["loop", "state", "evaluator", "run-log", "strategy", "experiment", "approval"]) {
    const data = JSON.parse(readText(schemaPath(schema)));
    checks.push({
      ok: typeof data.$id === "string" && data.$id.includes(`/v${pkg.version}/`),
      message: `schema $id is pinned to v${pkg.version}: ${schema}`
    });
  }
}

function checkCanonicalSkill(checks) {
  const result = validateSkillPackage(path.join(repoRoot, "skills", "loop-engineering"));
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
  for (const schema of ["loop", "state", "evaluator", "run-log", "strategy", "experiment", "approval"]) {
    try {
      JSON.parse(readText(schemaPath(schema)));
      checks.push({ ok: true, message: `schema parses: ${schema}` });
    } catch (error) {
      checks.push({ ok: false, message: `schema parses: ${schema} (${error.message})` });
    }
  }
}

function checkLoopSpecsValidate(checks) {
  for (const file of EXAMPLE_FILES) {
    const result = validateLoopFile(path.join(repoRoot, file));
    checks.push({
      ok: result.ok,
      message: result.ok ? `loop spec validates: ${file}` : `loop spec validates: ${file} (${result.errors.join("; ")})`
    });
  }
}

function checkTemplateDataValidate(checks) {
  for (const [schemaName, file] of TEMPLATE_DATA_FILES) {
    try {
      const ajv = new Ajv2020({ allErrors: true });
      if (schemaName === "experiment") {
        ajv.addSchema(JSON.parse(readText(schemaPath("strategy"))));
      }
      const validate = ajv.compile(JSON.parse(readText(schemaPath(schemaName))));
      const valid = validate(readData(path.join(repoRoot, file)));
      checks.push({
        ok: valid,
        message: valid ? `template data validates: ${file}` : `template data validates: ${file} (${formatAjvErrors(validate.errors)})`
      });
    } catch (error) {
      checks.push({ ok: false, message: `template data validates: ${file} (${error.message})` });
    }
  }
}

function checkAdaptersInSync(checks) {
  for (const [relativePath, expected] of staticAdapterFiles()) {
    const filePath = path.join(repoRoot, relativePath);
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

function checkSkillAssetsInSync(checks) {
  for (const name of [
    "loop.yaml",
    "state.json",
    "evaluator-result.json",
    "run-log.json",
    "strategy.json",
    "experiment.json",
    "approval.json"
  ]) {
    const skillAsset = path.join(repoRoot, "skills", "loop-engineering", "assets", name);
    const compatibilityTemplate = path.join(repoRoot, "templates", name);
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
