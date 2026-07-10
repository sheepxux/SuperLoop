import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { readData, readText, repoRoot, schemaPath } from "./fs-utils.js";
import { staticAdapterFiles } from "./skill-content.js";
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
  "templates/loop.yaml",
  "templates/state.json",
  "templates/strategy.json",
  "templates/experiment.json",
  "adapters/codex/SKILL.md",
  "adapters/claude-code/SKILL.md",
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
];

export function runDoctor() {
  const checks = [];
  checkNodeVersion(checks);
  checkRequiredFiles(checks);
  checkPackageMetadata(checks);
  checkSchemasParse(checks);
  checkLoopSpecsValidate(checks);
  checkTemplateDataValidate(checks);
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
  checks.push({ ok: Array.isArray(pkg.files) && pkg.files.includes("README.en.md"), message: "npm files include English README" });
  checks.push({ ok: Boolean(pkg.repository?.url), message: "package repository URL is set" });
}

function checkSchemasParse(checks) {
  for (const schema of ["loop", "state", "evaluator", "run-log", "strategy", "experiment"]) {
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

function formatAjvErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}
