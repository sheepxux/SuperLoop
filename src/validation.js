import Ajv2020 from "ajv/dist/2020.js";
import { readData, readText, schemaPath } from "./fs-utils.js";

const HIGH_RISK_PERMISSIONS = new Map([
  ["merge", "merge"],
  ["deploy", "deploy"],
  ["delete-data", "delete"],
  ["spend-money", "spend"],
  ["change-permissions", "permission"],
  ["write-external-system", "external"]
]);

const REVIEW_OUTPUTS = new Map([
  ["pull-request", "pull request"],
  ["issue-comment", "issue"]
]);

export function validateLoopFile(filePath) {
  return validateLoopSpec(readData(filePath), filePath);
}

export function validateData(schemaName, data, label = schemaName) {
  const ajv = new Ajv2020({ allErrors: true });
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

  if (!spec.persistence.statePath.includes(name)) {
    warnings.push(`persistence.statePath should include the loop name "${name}" for auditability.`);
  }

  if (!spec.persistence.runLogDir.includes(name)) {
    warnings.push(`persistence.runLogDir should include the loop name "${name}" for auditability.`);
  }

  const humanOnly = normalizeList(spec.safety.humanGates.humanOnly);
  for (const [permission, keyword] of HIGH_RISK_PERMISSIONS) {
    if (spec.handoff.permissions.includes(permission) && !containsKeyword(humanOnly, keyword)) {
      errors.push(`high-risk permission "${permission}" must be represented in safety.humanGates.humanOnly.`);
    }
  }

  const needsReview = normalizeList([
    ...spec.safety.humanGates.needsReview,
    ...spec.safety.humanGates.humanOnly
  ]);
  for (const [output, keyword] of REVIEW_OUTPUTS) {
    if (spec.outputs.includes(output) && !containsKeyword(needsReview, keyword)) {
      errors.push(`output "${output}" must have a matching needsReview or humanOnly gate.`);
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
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeList(values) {
  return values.map(normalize);
}

function containsKeyword(values, keyword) {
  return values.some((value) => value.includes(keyword));
}
