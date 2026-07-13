import Ajv2020 from "ajv/dist/2020.js";
import path from "node:path";
import { readData, readText, schemaPath } from "./fs-utils.js";

const HIGH_RISK_PERMISSIONS = new Map([
  ["merge", "merge-pull-request"],
  ["deploy", "deploy-production"],
  ["delete-data", "delete-data"],
  ["spend-money", "spend-money"],
  ["change-permissions", "change-permissions"],
  ["write-external-system", "write-external-system"],
  ["open-pr", "open-pull-request"],
  ["comment-issue", "comment-on-issue"]
]);

export function validateLoopFile(filePath) {
  return validateLoopSpec(readData(filePath), filePath);
}

export function validateData(schemaName, data, label = schemaName) {
  const ajv = new Ajv2020({ allErrors: true });
  if (schemaName === "experiment") {
    ajv.addSchema(JSON.parse(readText(schemaPath("strategy"))));
  }
  const validate = ajv.compile(JSON.parse(readText(schemaPath(schemaName))));
  const valid = validate(data);
  const errors = valid
    ? []
    : (validate.errors || []).map((error) => `${error.instancePath || "/"} ${error.message}`);
  return {
    ok: valid,
    label,
    errors,
    warnings: []
  };
}

export function validateLoopSpec(spec, label = "loop spec") {
  const ajv = new Ajv2020({ allErrors: true });
  const schema = JSON.parse(readText(schemaPath("loop")));
  const validate = ajv.compile(schema);
  const valid = validate(spec);
  const errors = [];
  const warnings = [];

  if (!valid) {
    for (const error of validate.errors || []) {
      errors.push(`${error.instancePath || "/"} ${error.message}`);
    }
  }

  if (errors.length === 0) {
    customChecks(spec, errors, warnings);
  }

  return {
    ok: errors.length === 0,
    label,
    errors,
    warnings
  };
}

function customChecks(spec, errors, warnings) {
  const name = spec.metadata.name;
  const worker = normalize(spec.handoff.worker);
  const evaluator = normalize(spec.verification.evaluator);

  if (worker === evaluator) {
    errors.push("verification.evaluator must be independent from handoff.worker.");
  }

  if (spec.verification.independent !== true) {
    errors.push("verification.independent must be true.");
  }

  if (spec.verification.defaultStance !== "assume-broken") {
    warnings.push("verification.defaultStance should normally be assume-broken for unattended loops.");
  }

  const writePermissions = new Set([
    "write-worktree",
    "open-pr",
    "comment-issue",
    "write-external-system",
    "deploy",
    "merge",
    "delete-data",
    "spend-money",
    "change-permissions"
  ]);
  const writes = spec.handoff.permissions.filter((permission) => writePermissions.has(permission));
  if (writes.length > 0 && spec.handoff.isolation === "none") {
    errors.push("handoff.isolation cannot be none when write permissions are requested.");
  }

  if (spec.handoff.isolation === "worktree" && !spec.handoff.worktree.enabled) {
    errors.push("handoff.worktree.enabled must be true when handoff.isolation is worktree.");
  }

  if (spec.discovery.maxItemsPerRun > spec.safety.budgets.maxItemsPerRun) {
    errors.push("discovery.maxItemsPerRun cannot exceed safety.budgets.maxItemsPerRun.");
  }

  if (spec.schedule.timeoutMinutes > spec.safety.budgets.maxRuntimeMinutes) {
    errors.push("schedule.timeoutMinutes cannot exceed safety.budgets.maxRuntimeMinutes.");
  }

  if (spec.schedule.runtime !== "manual" && spec.schedule.cadence === "manual") {
    errors.push("scheduled runtimes must define a non-manual cadence.");
  }

  if (spec.runner?.executor === "command" && !spec.runner.command) {
    errors.push("runner.command is required when runner.executor is command.");
  }

  if (spec.runner?.executor === "dry-run" && spec.runner.command) {
    warnings.push("runner.command is ignored when runner.executor is dry-run.");
  }

  if (!spec.persistence.statePath.includes(name)) {
    warnings.push(`persistence.statePath should include the loop name "${name}" for auditability.`);
  }

  if (!spec.persistence.runLogDir.includes(name)) {
    warnings.push(`persistence.runLogDir should include the loop name "${name}" for auditability.`);
  }

  const expectedRoot = `.loop-engineering/loops/${name}/`;
  for (const [field, value] of Object.entries(spec.persistence)) {
    if (!isSafeRelativePath(value)) {
      errors.push(`persistence.${field} must be a safe repository-relative path without traversal.`);
    } else if (!String(value).replaceAll("\\", "/").startsWith(expectedRoot)) {
      errors.push(`persistence.${field} must stay under ${expectedRoot}`);
    }
  }
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(spec.handoff.worktree.branchPrefix) || spec.handoff.worktree.branchPrefix.includes("..")) {
    errors.push("handoff.worktree.branchPrefix contains unsafe characters or traversal.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(spec.schedule.concurrency.group)) {
    errors.push("schedule.concurrency.group must be a safe identifier.");
  }
  if (spec.runner && !isSafeRelativePath(spec.runner.workingDirectory)) {
    errors.push("runner.workingDirectory must be a safe relative path without traversal.");
  }

  const humanOnly = new Set(normalizeList(spec.safety.humanGates.humanOnly));
  for (const [permission, actionId] of HIGH_RISK_PERMISSIONS) {
    if (spec.handoff.permissions.includes(permission) && !humanOnly.has(actionId)) {
      errors.push(`high-risk permission "${permission}" must be represented in safety.humanGates.humanOnly.`);
    }
  }

  const externalOutputs = new Map([
    ["pull-request", "open-pull-request"],
    ["issue-comment", "comment-on-issue"]
  ]);
  for (const [output, actionId] of externalOutputs) {
    if (spec.outputs.includes(output) && !humanOnly.has(actionId)) {
      errors.push(`external output "${output}" must have a matching humanOnly gate.`);
    }
  }

  if (spec.outputs.includes("pull-request") && !spec.handoff.permissions.includes("open-pr")) {
    warnings.push('outputs includes "pull-request" but handoff.permissions does not include "open-pr".');
  }

  const executableEvidence = ["tests", "typecheck", "lint", "build", "security-check", "dom-check"];
  if (
    spec.verification.requiredEvidence.some((evidence) => executableEvidence.includes(evidence)) &&
    spec.verification.commands.length === 0
  ) {
    errors.push("verification.commands must include at least one command for executable evidence.");
  }

  if (spec.evolution?.enabled) {
    if (!spec.persistence.strategyPath || !spec.persistence.experimentDir) {
      errors.push("evolution.enabled requires persistence.strategyPath and persistence.experimentDir.");
    }
    const evolutionEvaluator = normalize(spec.evolution.evaluator.name);
    if (evolutionEvaluator === worker || evolutionEvaluator === evaluator) {
      errors.push("evolution.evaluator.name must be independent from both the worker and task evaluator.");
    }
    if (spec.evolution.evaluator.independent !== true) {
      errors.push("evolution.evaluator.independent must be true.");
    }
    if (spec.evolution.promotion.mode === "automatic" && spec.metadata.risk !== "low") {
      errors.push("automatic strategy promotion is allowed only for low-risk loops.");
    }
  }

  const gates = spec.safety.humanGates;
  const allGates = [...gates.autoAllowed, ...gates.needsReview, ...gates.humanOnly];
  if (new Set(allGates).size !== allGates.length) {
    errors.push("safety.humanGates action IDs must be unique across autoAllowed, needsReview, and humanOnly.");
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeList(values) {
  return values.map(normalize);
}

function isSafeRelativePath(value) {
  const text = String(value || "");
  return text.length > 0 && !path.isAbsolute(text) && !text.includes("\0") && !text.split(/[\\/]/).includes("..");
}
