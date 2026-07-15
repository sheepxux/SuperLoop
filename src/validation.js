import Ajv2020 from "ajv/dist/2020.js";
import path from "node:path";
import { readData, readText, schemaPath, sha256Json } from "./fs-utils.js";

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
const validatorCache = new Map();

export function validateLoopFile(filePath) {
  return validateLoopSpec(readData(filePath), filePath);
}

export function validateData(schemaName, data, label = schemaName) {
  const validate = schemaValidator(schemaName);
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
  const validate = schemaValidator("loop");
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

function schemaValidator(schemaName) {
  if (validatorCache.has(schemaName)) return validatorCache.get(schemaName);
  const ajv = new Ajv2020({ allErrors: true });
  if (schemaName === "experiment") {
    ajv.addSchema(JSON.parse(readText(schemaPath("strategy"))));
  }
  if (schemaName === "proposal") {
    ajv.addSchema(JSON.parse(readText(schemaPath("loop"))));
  }
  const validate = ajv.compile(JSON.parse(readText(schemaPath(schemaName))));
  validatorCache.set(schemaName, validate);
  return validate;
}

export function approvedPersistenceLayoutErrors(spec) {
  const contractRoot = path.posix.join(".loop-engineering", "loops", spec.metadata.name);
  const expected = {
    statePath: path.posix.join(contractRoot, "state.json"),
    runLogDir: path.posix.join(contractRoot, "runs"),
    inboxPath: path.posix.join(contractRoot, "inbox.md"),
    decisionsPath: path.posix.join(contractRoot, "decisions.md")
  };
  if (spec.evolution?.enabled) {
    expected.strategyPath = path.posix.join(contractRoot, "strategy.json");
    expected.experimentDir = path.posix.join(contractRoot, "experiments");
  }
  return Object.entries(expected)
    .filter(([field, expectedPath]) => spec.persistence[field] !== expectedPath)
    .map(([field, expectedPath]) => (
      `A proposal-compiled Loop requires persistence.${field} to equal "${expectedPath}".`
    ));
}

function customChecks(spec, errors, warnings) {
  const name = spec.metadata.name;
  const worker = normalize(spec.handoff.worker);
  const evaluator = normalize(spec.verification.evaluator);

  validateGoalContract(spec, errors);
  validateWorkPlan(spec, errors);
  if (spec.metadata.provenance) {
    errors.push(...approvedPersistenceLayoutErrors(spec));
  }

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
    "write-local-files",
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

  const worktree = spec.handoff.worktree;
  if (["worktree", "branch"].includes(spec.handoff.isolation) && !worktree) {
    errors.push(`handoff.worktree is required when handoff.isolation is ${spec.handoff.isolation}.`);
  }
  if (spec.handoff.isolation === "worktree" && worktree && !worktree.enabled) {
    errors.push("handoff.worktree.enabled must be true when handoff.isolation is worktree.");
  }
  if (!["worktree", "branch"].includes(spec.handoff.isolation) && worktree?.enabled) {
    warnings.push(`handoff.worktree is enabled but unused when handoff.isolation is ${spec.handoff.isolation}.`);
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
  if (
    worktree
    && (!/^[a-z0-9][a-z0-9._/-]*$/.test(worktree.branchPrefix) || worktree.branchPrefix.includes(".."))
  ) {
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

function validateWorkPlan(spec, errors) {
  const plan = spec.workPlan;
  if (!plan) return;

  const partIds = plan.parts.map((part) => part.id);
  const duplicatePartIds = duplicateValues(partIds);
  if (duplicatePartIds.length > 0) {
    errors.push(`workPlan part IDs must be unique; duplicated: ${duplicatePartIds.join(", ")}.`);
  }

  const criterionIds = plan.parts.flatMap((part) => part.acceptanceCriteria.map((criterion) => criterion.id));
  const duplicateCriterionIds = duplicateValues(criterionIds);
  if (duplicateCriterionIds.length > 0) {
    errors.push(
      `workPlan acceptance criterion IDs must be globally unique; duplicated: ${duplicateCriterionIds.join(", ")}.`
    );
  }

  const artifactIds = plan.parts.flatMap((part) => part.expectedArtifacts.map((artifact) => artifact.id));
  const duplicateArtifactIds = duplicateValues(artifactIds);
  if (duplicateArtifactIds.length > 0) {
    errors.push(`workPlan expected artifact IDs must be globally unique; duplicated: ${duplicateArtifactIds.join(", ")}.`);
  }

  const knownParts = new Set(partIds);
  for (const part of plan.parts) {
    for (const dependency of part.dependsOn) {
      if (dependency === part.id) {
        errors.push(`workPlan part "${part.id}" cannot depend on itself.`);
      } else if (!knownParts.has(dependency)) {
        errors.push(`workPlan part "${part.id}" depends on unknown part "${dependency}".`);
      }
    }
  }

  validateWorkPlanGraph(plan.parts, errors);

  const goalCriteria = new Set(spec.goal.acceptanceCriteria);
  const coveredGoalCriteria = new Set();
  for (const part of plan.parts) {
    const partVerification = part.verification || spec.verification;
    const requiredEvidence = new Set(partVerification.requiredEvidence);
    for (const criterion of part.goalCriteria) {
      if (!goalCriteria.has(criterion)) {
        errors.push(`workPlan part "${part.id}" references an unknown goal criterion: ${criterion}`);
      } else {
        coveredGoalCriteria.add(criterion);
      }
    }
    for (const criterion of part.acceptanceCriteria) {
      for (const evidence of criterion.evidence) {
        if (!requiredEvidence.has(evidence)) {
          errors.push(
            `workPlan criterion ${criterion.id} requires evidence "${evidence}" `
            + `that is missing from the effective verification envelope for Part "${part.id}".`
          );
        }
      }
    }
    const executableEvidence = ["tests", "typecheck", "lint", "build", "security-check", "dom-check"];
    if (
      partVerification.requiredEvidence.some((evidence) => executableEvidence.includes(evidence))
      && partVerification.commands.length === 0
    ) {
      errors.push(
        `workPlan Part "${part.id}" requires at least one command for executable evidence in its effective verification envelope.`
      );
    }
  }
  for (const criterion of goalCriteria) {
    if (!coveredGoalCriteria.has(criterion)) {
      errors.push(`workPlan parts do not cover goal criterion: ${criterion}`);
    }
  }

  if (plan.maxPartsPerRun > spec.discovery.maxItemsPerRun) {
    errors.push("workPlan.maxPartsPerRun cannot exceed discovery.maxItemsPerRun.");
  }
  if (plan.maxPartsPerRun > spec.safety.budgets.maxItemsPerRun) {
    errors.push("workPlan.maxPartsPerRun cannot exceed safety.budgets.maxItemsPerRun.");
  }
  if (normalize(plan.completion.evaluator) === normalize(spec.handoff.worker)) {
    errors.push("workPlan.completion.evaluator must be independent from handoff.worker.");
  }
  if (normalize(plan.completion.evaluator) === normalize(spec.verification.evaluator)) {
    errors.push("workPlan.completion.evaluator must be independent from verification.evaluator.");
  }
  const completionEvidence = new Set(plan.completion.requiredEvidence);
  for (const evidence of spec.verification.requiredEvidence) {
    if (!completionEvidence.has(evidence)) {
      errors.push(
        `workPlan.completion.requiredEvidence must include verification evidence "${evidence}" for the whole-Goal Gate.`
      );
    }
  }
  for (const command of spec.verification.commands) {
    if (!plan.completion.commands.includes(command)) {
      errors.push(
        `workPlan.completion.commands must include verification command "${command}" for the whole-Goal Gate.`
      );
    }
  }
  const executableEvidence = ["tests", "typecheck", "lint", "build", "security-check", "dom-check"];
  if (
    plan.completion.requiredEvidence.some((evidence) => executableEvidence.includes(evidence))
    && plan.completion.commands.length === 0
  ) {
    errors.push("workPlan.completion.commands must include at least one command for executable Goal evidence.");
  }
}

function validateWorkPlanGraph(parts, errors) {
  const uniqueIds = new Set(parts.map((part) => part.id));
  if (uniqueIds.size !== parts.length) return;

  const dependencies = new Map(parts.map((part) => [
    part.id,
    part.dependsOn.filter((dependency) => uniqueIds.has(dependency) && dependency !== part.id)
  ]));
  const visitState = new Map();
  let cycleDetected = false;

  function visit(id) {
    const state = visitState.get(id) || 0;
    if (state === 1) {
      cycleDetected = true;
      return;
    }
    if (state === 2) return;
    visitState.set(id, 1);
    for (const dependency of dependencies.get(id) || []) visit(dependency);
    visitState.set(id, 2);
  }

  for (const id of uniqueIds) visit(id);
  if (cycleDetected) {
    errors.push("workPlan dependencies must form an acyclic graph.");
    return;
  }

  const dependents = new Map([...uniqueIds].map((id) => [id, []]));
  for (const [partId, partDependencies] of dependencies) {
    for (const dependency of partDependencies) dependents.get(dependency).push(partId);
  }
  const reachesSink = new Map();
  function canReachSink(id) {
    if (reachesSink.has(id)) return reachesSink.get(id);
    const next = dependents.get(id) || [];
    const result = next.length === 0 || next.some(canReachSink);
    reachesSink.set(id, result);
    return result;
  }
  for (const id of uniqueIds) {
    if (!canReachSink(id)) errors.push(`workPlan part "${id}" does not reach a terminal sink part.`);
  }
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function validateGoalContract(spec, errors) {
  const provenance = spec.metadata.provenance;
  if (provenance) {
    validateDecisionProvenance(provenance, errors);
  }
  if (provenance && spec.goalContract === undefined) {
    errors.push("A provenance-bound Loop must retain the complete approved goalContract.");
    return;
  }
  if (spec.goalContract === undefined) return;

  const contract = spec.goalContract;
  if (provenance && provenance.proposal.goalContractSha256 !== sha256Json(contract)) {
    errors.push("metadata.provenance.proposal.goalContractSha256 does not match goalContract.");
  }
  if (provenance) {
    const candidateLoop = structuredClone(spec);
    delete candidateLoop.metadata.provenance;
    delete candidateLoop.goalContract;
    if (provenance.proposal.candidateLoopSha256 !== sha256Json(candidateLoop)) {
      errors.push("metadata.provenance.proposal.candidateLoopSha256 does not match the compiled Loop body.");
    }
  }
  if (spec.goal.objective !== contract.objective.statement) {
    errors.push("goal.objective must exactly match goalContract.objective.statement.");
  }
  requireExactGoalSet(
    spec.goal.acceptanceCriteria,
    contract.acceptanceCriteria.map((criterion) => criterion.statement),
    "acceptance criteria",
    errors
  );
  requireExactGoalSet(
    spec.goal.stopConditions,
    contract.stopConditions.map((condition) => condition.condition),
    "stop conditions",
    errors
  );
  requireExactGoalSet(
    spec.goal.blockedConditions,
    contract.blockedConditions.map((condition) => condition.condition),
    "blocked conditions",
    errors
  );

  const requiredEvidence = new Set(spec.verification.requiredEvidence);
  for (const criterion of contract.acceptanceCriteria) {
    for (const evidence of criterion.evidence) {
      if (!requiredEvidence.has(evidence)) {
        errors.push(
          `goalContract acceptance criterion ${criterion.id} requires evidence "${evidence}" `
          + "that is missing from verification.requiredEvidence."
        );
      }
    }
  }
}

function validateDecisionProvenance(provenance, errors) {
  const decision = provenance.decision;
  const reconstructed = {
    apiVersion: "loop-engineering/v1",
    kind: "LoopProposalDecision",
    proposalId: provenance.proposal.id,
    proposalRevision: provenance.proposal.revision,
    proposalSha256: provenance.proposal.sha256,
    decision: decision.outcome,
    actorType: decision.actorType,
    actor: decision.actor,
    decidedAt: decision.decidedAt,
    reason: decision.reason,
    requestedChanges: []
  };
  if (decision.sha256 !== sha256Json(reconstructed)) {
    errors.push("metadata.provenance.decision.sha256 does not match the retained human decision fields.");
  }
}

function requireExactGoalSet(operational, contracted, label, errors) {
  const operationalSet = new Set(operational);
  const contractSet = new Set(contracted);
  const missing = [...contractSet].filter((value) => !operationalSet.has(value));
  const extra = [...operationalSet].filter((value) => !contractSet.has(value));
  if (operationalSet.size !== operational.length || contractSet.size !== contracted.length) {
    errors.push(`goalContract and operational ${label} must not contain duplicate statements.`);
  }
  if (missing.length > 0 || extra.length > 0) {
    errors.push(`goalContract ${label} must exactly match the operational goal.`);
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
