import Ajv2020 from "ajv/dist/2020.js";
import { readData, readText, schemaPath, sha256Json } from "./fs-utils.js";
import { approvedPersistenceLayoutErrors, validateLoopSpec } from "./validation.js";

const LOOP_ROUTES = new Set(["agentic-loop", "unsafe-loop"]);
const NON_LOOP_ROUTES = new Set(["one-shot", "deterministic"]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const EXPECTED_ACTION_TRACE = new Map([
  ["permission:read-repo", "read-repository"],
  ["permission:read-local-files", "read-local-files"],
  ["permission:read-approved-sources", "read-approved-sources"],
  ["permission:write-worktree", "write-isolated-worktree"],
  ["permission:write-local-files", "write-local-files"],
  ["permission:run-tests", "run-tests"],
  ["permission:run-approved-tools", "run-approved-tools"],
  ["permission:open-pr", "open-pull-request"],
  ["permission:comment-issue", "comment-on-issue"],
  ["permission:write-external-system", "write-external-system"],
  ["permission:deploy", "deploy-production"],
  ["permission:merge", "merge-pull-request"],
  ["permission:delete-data", "delete-data"],
  ["permission:spend-money", "spend-money"],
  ["permission:change-permissions", "change-permissions"],
  ["output:run-summary", "write-run-summary"],
  ["output:inbox-update", "update-inbox"],
  ["output:pull-request", "open-pull-request"],
  ["output:issue-comment", "comment-on-issue"],
  ["output:patch", "write-patch"],
  ["output:report", "write-report"],
  ["output:artifact", "write-artifact"]
]);
const HUMAN_ONLY_TRACE_KEYS = new Set([
  "permission:open-pr",
  "permission:comment-issue",
  "permission:write-external-system",
  "permission:deploy",
  "permission:merge",
  "permission:delete-data",
  "permission:spend-money",
  "permission:change-permissions",
  "output:pull-request",
  "output:issue-comment"
]);
const RISK_RANK = new Map([["low", 1], ["medium", 2], ["high", 3]]);

export function validateProposalFile(filePath) {
  return validateProposalSpec(readData(filePath), filePath);
}

export function validateProposalSpec(proposal, label = "Loop proposal") {
  const errors = [];
  const warnings = [];
  const schemaValidation = validateProposalSchema(proposal);

  if (!schemaValidation.ok) {
    return {
      ok: false,
      label,
      errors: schemaValidation.errors,
      warnings
    };
  }

  if (!isValidUtcTimestamp(proposal.createdAt)) {
    errors.push("createdAt must be a real ISO-8601 UTC timestamp.");
  }
  if (proposal.metadata.revision === 1 && proposal.metadata.parentProposalSha256 !== null) {
    errors.push("metadata.parentProposalSha256 must be null for revision 1.");
  }
  if (proposal.metadata.revision > 1 && proposal.metadata.parentProposalSha256 === null) {
    errors.push("metadata.parentProposalSha256 is required after revision 1.");
  }

  validateUniqueIds(proposal, errors);

  const route = proposal.routing.classification;
  const isLoop = LOOP_ROUTES.has(route);
  const isNonLoop = NON_LOOP_ROUTES.has(route);
  const readiness = proposal.readiness.status;
  for (const warning of proposal.readiness.warnings) {
    warnings.push(`readiness: ${warning}`);
  }

  if (isNonLoop) {
    if (proposal.routing.executionShape !== null) {
      errors.push(`${route} proposals must use routing.executionShape null.`);
    }
    if (readiness !== "not-applicable") {
      errors.push(`${route} proposals must use readiness "not-applicable".`);
    }
    if (proposal.candidate !== null) {
      errors.push(`${route} proposals cannot contain a candidate Loop contract.`);
    }
    if (proposal.alternative === null) {
      errors.push(`${route} proposals must recommend a direct or deterministic alternative.`);
    }
  }

  if (route === "agentic-loop" && readiness === "not-applicable") {
    errors.push('agentic-loop proposals cannot use readiness "not-applicable".');
  }
  if (isLoop && proposal.candidate !== null) {
    const hasWorkPlan = proposal.candidate.loop.workPlan !== undefined;
    if (proposal.routing.executionShape === "finite-plan" && !hasWorkPlan) {
      errors.push('routing.executionShape "finite-plan" requires candidate.loop.workPlan.');
    }
    if (proposal.routing.executionShape === "continuous-stream" && hasWorkPlan) {
      errors.push('routing.executionShape "continuous-stream" cannot contain candidate.loop.workPlan.');
    }
    if (proposal.routing.executionShape === null) {
      errors.push("A candidate agentic or unsafe Loop requires an explicit routing.executionShape.");
    }
  }
  if (route === "unsafe-loop" && readiness === "not-applicable" && proposal.routing.executionShape !== null) {
    errors.push('A declined unsafe-loop proposal must use routing.executionShape null.');
  }
  if (route === "unsafe-loop" && readiness === "not-applicable") {
    if (proposal.candidate !== null) {
      errors.push('A declined unsafe-loop proposal cannot contain a candidate Loop contract.');
    }
    if (proposal.alternative === null) {
      errors.push('A declined unsafe-loop proposal must provide a redesign or decline alternative.');
    }
  }

  const gaps = blockingGaps(proposal);
  const declaredBlockers = new Set(proposal.readiness.blockers);
  for (const gap of gaps) {
    if (!declaredBlockers.has(gap)) {
      errors.push(`readiness.blockers is missing blocking gap ${gap}.`);
    }
  }
  for (const blocker of declaredBlockers) {
    if (!gaps.includes(blocker)) {
      errors.push(`readiness.blockers contains unknown or resolved gap ${blocker}.`);
    }
  }

  if (readiness === "ready-for-review") {
    if (!isLoop) {
      errors.push('Only agentic-loop or unsafe-loop proposals can be "ready-for-review".');
    }
    if (proposal.candidate === null) {
      errors.push('readiness "ready-for-review" requires a candidate Loop contract.');
    }
    if (gaps.length > 0) errors.push("ready-for-review proposal cannot have blocking gaps.");
  }

  if (readiness === "needs-input" && gaps.length === 0) {
    errors.push('readiness "needs-input" requires at least one explicit blocking question, assumption, prerequisite, or risk.');
  }

  if (proposal.candidate !== null) {
    if (!isLoop) {
      errors.push("Only agentic-loop or unsafe-loop routes may include a candidate Loop contract.");
    }
    validateCandidate(proposal, errors, warnings);
  }

  if (route === "unsafe-loop" && readiness === "ready-for-review") {
    warnings.push("unsafe-loop is ready only for human review; compilation does not waive any Loop human gate.");
  }

  return {
    ok: errors.length === 0,
    label,
    errors,
    warnings
  };
}

export function createProposalRevision(parentProposal, { now = new Date() } = {}) {
  const parentValidation = validateProposalSpec(parentProposal, "parent Loop proposal");
  if (!parentValidation.ok) {
    throw new Error(`Cannot revise an invalid parent Loop proposal: ${parentValidation.errors.join("; ")}`);
  }

  const createdAt = timestampFrom(now);
  if (Date.parse(createdAt) < Date.parse(parentProposal.createdAt)) {
    throw new Error("A Loop proposal revision cannot predate its parent proposal.");
  }

  const revision = structuredClone(parentProposal);
  revision.metadata.revision = parentProposal.metadata.revision + 1;
  revision.metadata.parentProposalSha256 = sha256Json(parentProposal);
  revision.createdAt = createdAt;
  return revision;
}

export function validateProposalRevision(proposal, parentProposal, label = "Loop proposal revision") {
  const proposalValidation = validateProposalSpec(proposal, label);
  const parentValidation = validateProposalSpec(parentProposal, "parent Loop proposal");
  const errors = [...proposalValidation.errors];
  const warnings = [...proposalValidation.warnings];

  if (!parentValidation.ok) {
    errors.push(...parentValidation.errors.map((error) => `parent proposal: ${error}`));
  }
  if (proposalValidation.ok && parentValidation.ok) {
    if (proposal.metadata.id !== parentProposal.metadata.id) {
      errors.push("A proposal revision must preserve the parent proposal metadata.id.");
    }
    if (proposal.metadata.revision !== parentProposal.metadata.revision + 1) {
      errors.push("A proposal revision must increment the parent revision by exactly one.");
    }
    if (proposal.metadata.parentProposalSha256 !== sha256Json(parentProposal)) {
      errors.push("metadata.parentProposalSha256 does not match the exact parent proposal content.");
    }
    if (Date.parse(proposal.createdAt) < Date.parse(parentProposal.createdAt)) {
      errors.push("A proposal revision cannot predate its parent proposal.");
    }
  }

  return {
    ok: errors.length === 0,
    label,
    errors,
    warnings
  };
}

export function createProposalDecision(
  proposal,
  {
    decision,
    actor,
    actorType = "human",
    reason,
    requestedChanges = [],
    parentProposal = null,
    decidedAt,
    now = new Date()
  } = {}
) {
  const proposalValidation = validateProposalSpec(proposal);
  if (!proposalValidation.ok) {
    throw new Error(`Cannot decide an invalid Loop proposal: ${proposalValidation.errors.join("; ")}`);
  }
  if (actorType !== "human") {
    throw new Error("A Loop proposal decision must be made by actorType human.");
  }
  if (typeof actor !== "string" || actor.trim().length === 0) {
    throw new Error("A Loop proposal decision requires a non-empty human actor assertion.");
  }
  validateIndependentProposalActor(proposal, actor);
  if (typeof reason !== "string" || reason.trim().length < 5) {
    throw new Error("A Loop proposal decision requires a meaningful reason of at least 5 characters.");
  }
  if (!Array.isArray(requestedChanges) || requestedChanges.some((change) => (
    typeof change !== "string" || change.trim().length < 3
  ))) {
    throw new Error("Every requested proposal change must contain at least 3 non-whitespace characters.");
  }
  if (proposal.metadata.revision > 1) {
    if (parentProposal === null) {
      throw new Error("A decision for proposal revision 2 or later requires the exact parent proposal.");
    }
    const revisionValidation = validateProposalRevision(proposal, parentProposal);
    if (!revisionValidation.ok) {
      throw new Error(`Cannot decide an unverifiable proposal revision: ${revisionValidation.errors.join("; ")}`);
    }
  } else if (parentProposal !== null) {
    throw new Error("Proposal revision 1 cannot have a parent proposal.");
  }
  if (decision === "approve" && proposal.readiness.status !== "ready-for-review") {
    throw new Error('Only a proposal with readiness "ready-for-review" can be approved.');
  }

  const trustedNow = timestampFrom(now);
  const timestamp = decidedAt ?? trustedNow;
  const artifact = {
    apiVersion: "superloop/v2",
    kind: "LoopProposalDecision",
    proposalId: proposal.metadata.id,
    proposalRevision: proposal.metadata.revision,
    proposalSha256: sha256Json(proposal),
    decision,
    actorType: "human",
    actor: actor.trim(),
    decidedAt: timestamp,
    reason: reason.trim(),
    requestedChanges: requestedChanges.map((change) => change.trim())
  };
  const validation = validateDecisionSpec(artifact);
  if (!validation.ok) {
    throw new Error(`Refusing to create an invalid proposal decision: ${validation.errors.join("; ")}`);
  }
  if (!isValidUtcTimestamp(timestamp)) {
    throw new Error("Proposal decision decidedAt must be a real ISO-8601 UTC timestamp.");
  }
  if (Date.parse(timestamp) < Date.parse(proposal.createdAt)) {
    throw new Error("Proposal decision cannot predate the proposal revision.");
  }
  if (Date.parse(timestamp) > Date.parse(trustedNow) + 5 * 60_000) {
    throw new Error("Proposal decision cannot be more than five minutes in the future.");
  }
  return artifact;
}

export function compileProposal(proposal, decision, { now = new Date(), parentProposal = null } = {}) {
  const proposalValidation = validateProposalSpec(proposal);
  if (!proposalValidation.ok) {
    throw new Error(`Cannot compile an invalid Loop proposal: ${proposalValidation.errors.join("; ")}`);
  }

  const decisionValidation = validateDecisionSpec(decision);
  if (!decisionValidation.ok) {
    throw new Error(`Cannot compile with an invalid proposal decision: ${decisionValidation.errors.join("; ")}`);
  }
  if (!isValidUtcTimestamp(decision.decidedAt)) {
    throw new Error("Proposal decision decidedAt must be a real ISO-8601 UTC timestamp.");
  }
  if (Date.parse(decision.decidedAt) < Date.parse(proposal.createdAt)) {
    throw new Error("Proposal decision cannot predate the proposal revision.");
  }
  const trustedNow = timestampFrom(now);
  if (Date.parse(decision.decidedAt) > Date.parse(trustedNow) + 5 * 60_000) {
    throw new Error("Proposal decision cannot be more than five minutes in the future.");
  }
  if (decision.decision !== "approve") {
    throw new Error(`Cannot compile a proposal whose decision is "${decision.decision}".`);
  }
  if (decision.actorType !== "human") {
    throw new Error("Only a human approval can compile a Loop proposal.");
  }
  validateIndependentProposalActor(proposal, decision.actor);
  if (proposal.metadata.revision > 1) {
    if (parentProposal === null) {
      throw new Error("Compiling proposal revision 2 or later requires the exact parent proposal.");
    }
    const revisionValidation = validateProposalRevision(proposal, parentProposal);
    if (!revisionValidation.ok) {
      throw new Error(`Cannot compile an unverifiable proposal revision: ${revisionValidation.errors.join("; ")}`);
    }
  } else if (parentProposal !== null) {
    throw new Error("Proposal revision 1 cannot have a parent proposal.");
  }
  if (proposal.readiness.status !== "ready-for-review" || proposal.candidate === null) {
    throw new Error('Only a ready-for-review proposal with a candidate Loop contract can be compiled.');
  }
  if (decision.proposalId !== proposal.metadata.id || decision.proposalRevision !== proposal.metadata.revision) {
    throw new Error("Proposal decision does not match the proposal ID and revision.");
  }

  const proposalSha256 = sha256Json(proposal);
  if (decision.proposalSha256 !== proposalSha256) {
    throw new Error("Proposal decision digest does not match the exact proposal content.");
  }

  const compiled = structuredClone(proposal.candidate.loop);
  compiled.goalContract = structuredClone(proposal.goal);
  compiled.metadata.provenance = {
    proposal: {
      id: proposal.metadata.id,
      revision: proposal.metadata.revision,
      sha256: proposalSha256,
      goalContractSha256: sha256Json(compiled.goalContract),
      candidateLoopSha256: sha256Json(proposal.candidate.loop)
    },
    decision: {
      outcome: "approve",
      sha256: sha256Json(decision),
      actorType: "human",
      actor: decision.actor,
      decidedAt: decision.decidedAt,
      reason: decision.reason
    }
  };

  const loopValidation = validateLoopSpec(compiled, "compiled Loop contract");
  if (!loopValidation.ok) {
    throw new Error(`Compiled Loop contract is invalid: ${loopValidation.errors.join("; ")}`);
  }
  return compiled;
}

function validateProposalSchema(proposal) {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(JSON.parse(readText(schemaPath("loop"))));
  const validate = ajv.compile(JSON.parse(readText(schemaPath("proposal"))));
  return validationResult(validate, proposal);
}

function validateDecisionSpec(decision) {
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(JSON.parse(readText(schemaPath("proposal-decision"))));
  return validationResult(validate, decision);
}

function validationResult(validate, value) {
  const valid = validate(value);
  return {
    ok: valid,
    errors: valid
      ? []
      : (validate.errors || []).map((error) => `${error.instancePath || "/"} ${error.message}`)
  };
}

function validateUniqueIds(proposal, errors) {
  const ids = [
    proposal.goal.objective.id,
    ...proposal.goal.acceptanceCriteria.map((item) => item.id),
    ...proposal.goal.nonGoals.map((item) => item.id),
    ...proposal.goal.stopConditions.map((item) => item.id),
    ...proposal.goal.blockedConditions.map((item) => item.id),
    ...proposal.questions.map((item) => item.id),
    ...proposal.assumptions.map((item) => item.id),
    ...proposal.prerequisites.map((item) => item.id),
    ...proposal.risks.map((item) => item.id)
  ];
  const duplicates = duplicateValues(ids);
  if (duplicates.length > 0) {
    errors.push(`Proposal stable IDs must be globally unique; duplicated: ${duplicates.join(", ")}.`);
  }
}

function blockingGaps(proposal) {
  return [
    ...proposal.questions.filter((item) => item.blocking).map((item) => item.id),
    ...proposal.assumptions
      .filter((item) => item.blocking && item.status !== "confirmed")
      .map((item) => item.id),
    ...proposal.prerequisites
      .filter((item) => item.blocking && item.status !== "met")
      .map((item) => item.id),
    ...proposal.risks
      .filter((item) => item.blocking && item.status === "open")
      .map((item) => item.id)
  ].sort();
}

function validateCandidate(proposal, errors, warnings) {
  const candidate = proposal.candidate;
  if (candidate.loop.metadata.provenance !== undefined) {
    errors.push("candidate.loop must not contain metadata.provenance; only compileProposal may add authorization provenance.");
  }
  if (candidate.loop.goalContract !== undefined) {
    errors.push("candidate.loop must not contain goalContract; only compileProposal may copy the complete approved Goal Contract.");
  }
  if (proposal.readiness.status === "ready-for-review" && candidate.loop.metadata.risk === undefined) {
    errors.push("A ready-for-review candidate Loop must declare metadata.risk.");
  }
  const highestDeclaredRisk = proposal.risks.reduce(
    (highest, risk) => Math.max(highest, RISK_RANK.get(risk.severity) || 0),
    0
  );
  const candidateRisk = RISK_RANK.get(candidate.loop.metadata.risk) || 0;
  if (candidateRisk < highestDeclaredRisk) {
    errors.push("candidate.loop.metadata.risk cannot be lower than the highest declared proposal risk severity.");
  }
  if (proposal.routing.classification === "unsafe-loop" && candidate.loop.metadata.risk !== "high") {
    errors.push('An unsafe-loop candidate must retain metadata.risk "high" even after adding human gates.');
  }

  const loopValidation = validateLoopSpec(candidate.loop, "candidate Loop contract");
  for (const error of loopValidation.errors) errors.push(`candidate.loop: ${error}`);
  for (const warning of loopValidation.warnings) warnings.push(`candidate.loop: ${warning}`);
  for (const error of approvedPersistenceLayoutErrors(candidate.loop)) {
    errors.push(`candidate.loop: ${error}`);
  }

  if (candidate.loop.goal.objective !== proposal.goal.objective.statement) {
    errors.push("candidate.loop.goal.objective must exactly match goal.objective.statement.");
  }
  requireExactStringSet(
    proposal.goal.acceptanceCriteria.map((item) => item.statement),
    candidate.loop.goal.acceptanceCriteria,
    "acceptance criteria",
    errors
  );
  requireExactStringSet(
    proposal.goal.stopConditions.map((item) => item.condition),
    candidate.loop.goal.stopConditions,
    "stop conditions",
    errors
  );
  requireExactStringSet(
    proposal.goal.blockedConditions.map((item) => item.condition),
    candidate.loop.goal.blockedConditions,
    "blocked conditions",
    errors
  );

  const criteria = new Map(proposal.goal.acceptanceCriteria.map((item) => [item.id, item]));
  const traceIds = candidate.acceptanceTrace.map((item) => item.acceptanceId);
  const duplicateTraceIds = duplicateValues(traceIds);
  if (duplicateTraceIds.length > 0) {
    errors.push(`candidate.acceptanceTrace contains duplicate acceptance IDs: ${duplicateTraceIds.join(", ")}.`);
  }

  for (const acceptanceId of criteria.keys()) {
    if (!traceIds.includes(acceptanceId)) {
      errors.push(`Acceptance criterion ${acceptanceId} is not traced into the candidate Loop.`);
    }
  }
  for (const trace of candidate.acceptanceTrace) {
    const criterion = criteria.get(trace.acceptanceId);
    if (!criterion) {
      errors.push(`candidate.acceptanceTrace references unknown acceptance ID ${trace.acceptanceId}.`);
      continue;
    }
    if (trace.loopCriterion !== criterion.statement) {
      errors.push(`Trace ${trace.acceptanceId} must preserve the exact acceptance statement.`);
    }
    if (!candidate.loop.goal.acceptanceCriteria.includes(trace.loopCriterion)) {
      errors.push(`Trace ${trace.acceptanceId} does not name an acceptance criterion in candidate.loop.goal.`);
    }
    for (const evidence of criterion.evidence) {
      if (!trace.evidence.includes(evidence)) {
        errors.push(`Trace ${trace.acceptanceId} omits required evidence "${evidence}".`);
      }
    }
    for (const evidence of trace.evidence) {
      if (!candidate.loop.verification.requiredEvidence.includes(evidence)) {
        errors.push(`Trace ${trace.acceptanceId} evidence "${evidence}" is not required by candidate.loop.verification.`);
      }
    }
  }

  validateActionTrace(candidate, errors);
}

function validateActionTrace(candidate, errors) {
  const expected = [
    ...candidate.loop.handoff.permissions.map((value) => ({ kind: "permission", value })),
    ...candidate.loop.outputs.map((value) => ({ kind: "output", value }))
  ];
  const keys = candidate.actionTrace.map((item) => actionTraceKey(item.kind, item.value));
  const duplicateKeys = duplicateValues(keys);
  if (duplicateKeys.length > 0) {
    errors.push(`candidate.actionTrace contains duplicate actions: ${duplicateKeys.join(", ")}.`);
  }

  for (const action of expected) {
    const key = actionTraceKey(action.kind, action.value);
    if (!keys.includes(key)) {
      errors.push(`candidate.actionTrace does not govern ${key}.`);
    }
  }
  const expectedKeys = new Set(expected.map((item) => actionTraceKey(item.kind, item.value)));
  for (const trace of candidate.actionTrace) {
    const key = actionTraceKey(trace.kind, trace.value);
    if (!expectedKeys.has(key)) {
      errors.push(`candidate.actionTrace references unknown action ${key}.`);
    }
    if (!candidate.loop.safety.humanGates[trace.gate].includes(trace.actionId)) {
      errors.push(`Action ${key} maps to ${trace.gate}.${trace.actionId}, but that gate action does not exist in candidate.loop.`);
    }
    const expectedAction = EXPECTED_ACTION_TRACE.get(key);
    if (expectedAction && trace.actionId !== expectedAction) {
      errors.push(`Action ${key} must trace to the typed gate action ${expectedAction}.`);
    }
    if (HUMAN_ONLY_TRACE_KEYS.has(key) && trace.gate !== "humanOnly") {
      errors.push(`High-impact action ${key} must trace exactly to humanOnly.${expectedAction}.`);
    }
  }
}

function actionTraceKey(kind, value) {
  return `${kind}:${value}`;
}

function requireExactStringSet(proposalValues, loopValues, label, errors) {
  const proposalSet = new Set(proposalValues);
  const loopSet = new Set(loopValues);
  const missing = [...proposalSet].filter((value) => !loopSet.has(value));
  const extra = [...loopSet].filter((value) => !proposalSet.has(value));
  if (proposalSet.size !== proposalValues.length) {
    errors.push(`Proposal ${label} must not contain duplicate statements.`);
  }
  if (loopSet.size !== loopValues.length) {
    errors.push(`candidate.loop.goal ${label} must not contain duplicate statements.`);
  }
  if (missing.length > 0) {
    errors.push(`candidate.loop.goal ${label} is missing: ${missing.join(" | ")}.`);
  }
  if (extra.length > 0) {
    errors.push(`candidate.loop.goal ${label} adds unapproved content: ${extra.join(" | ")}.`);
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

function timestampFrom(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Proposal decision clock must be a valid Date.");
  }
  return value.toISOString();
}

function isValidUtcTimestamp(value) {
  if (typeof value !== "string" || !ISO_UTC.test(value)) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  return new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19);
}

function validateIndependentProposalActor(proposal, actor) {
  if (proposal.candidate === null) return;
  const normalizedActor = normalizeIdentity(actor);
  const prohibited = new Set([
    proposal.candidate.loop.handoff.worker,
    proposal.candidate.loop.verification.evaluator,
    proposal.candidate.loop.evolution?.evaluator?.name
  ].filter(Boolean).map(normalizeIdentity));
  if (prohibited.has(normalizedActor)) {
    throw new Error("Proposal decision actor must be independent from configured worker and evaluator identities.");
  }
}

function normalizeIdentity(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
