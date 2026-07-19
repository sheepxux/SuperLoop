import { sha256Json } from "./fs-utils.js";

export function initialEvolutionState(strategy = null) {
  return {
    currentStrategyVersion: 1,
    currentStrategySha256: strategy ? sha256Json(strategy) : null,
    strategyArchives: strategy ? [{ version: strategy.version, sha256: sha256Json(strategy) }] : [],
    runsSincePromotion: 0,
    consecutiveFailures: 0,
    runsSinceExperiment: 0,
    consecutiveFailuresSinceExperiment: 0,
    pendingExperiment: null,
    observations: [],
    history: [],
    rollbackHistory: []
  };
}

export function initialStrategy(spec, loopName) {
  return {
    apiVersion: "superloop/v2",
    loop: loopName,
    version: 1,
    instructions: spec.evolution.initialStrategy,
    hypothesis: "Initial task strategy from loop.yaml",
    parentVersion: null,
    createdAt: null
  };
}

export function evolutionPlan(spec, state, paths) {
  if (!spec.evolution?.enabled) {
    return { enabled: false, due: false };
  }

  const current = state.evolution || initialEvolutionState();
  const reasons = [];
  const runsSinceExperiment = current.runsSinceExperiment ?? current.runsSincePromotion ?? 0;
  const failuresSinceExperiment = current.consecutiveFailuresSinceExperiment
    ?? current.consecutiveFailures
    ?? 0;
  if (runsSinceExperiment >= spec.evolution.trigger.afterRuns) {
    reasons.push(
      `Strategy has accumulated ${runsSinceExperiment} attributable run(s) since the last experiment; threshold is ${spec.evolution.trigger.afterRuns}.`
    );
  }
  if (failuresSinceExperiment >= spec.evolution.trigger.consecutiveFailures) {
    reasons.push(
      `Strategy has ${failuresSinceExperiment} consecutive failed run(s) since the last experiment; threshold is ${spec.evolution.trigger.consecutiveFailures}.`
    );
  }

  return {
    enabled: true,
    due: reasons.length > 0,
    reasons,
    currentStrategyVersion: current.currentStrategyVersion,
    strategyPath: paths.strategyPath,
    experimentDir: paths.experimentDir,
    pendingExperiment: current.pendingExperiment,
    currentStrategySha256: current.currentStrategySha256,
    metric: spec.evolution.metric,
    evaluator: spec.evolution.evaluator,
    promotion: spec.evolution.promotion
  };
}

export function updateEvolutionForRun(spec, prior, runLog) {
  if (!spec.evolution?.enabled) {
    return undefined;
  }

  const next = structuredClone(prior || initialEvolutionState());
  if (runLog.results.length === 0 || ["dry-run", "no-work", "budget-exceeded"].includes(runLog.status)) {
    return next;
  }
  next.runsSincePromotion += 1;
  next.consecutiveFailures = runSucceeded(runLog) ? 0 : next.consecutiveFailures + 1;
  next.runsSinceExperiment = (next.runsSinceExperiment ?? next.runsSincePromotion - 1) + 1;
  next.consecutiveFailuresSinceExperiment = runSucceeded(runLog)
    ? 0
    : (next.consecutiveFailuresSinceExperiment ?? next.consecutiveFailures - 1) + 1;

  const metric = spec.evolution.metric.name;
  const score = runLog.metrics?.[metric];
  if (typeof score === "number" && Number.isFinite(score)) {
    next.observations.push({
      runId: runLog.runId,
      metric,
      score,
      strategyVersion: runLog.strategy.version,
      strategySha256: runLog.strategy.sha256
    });
    next.observations = next.observations.slice(-100);
  }

  return next;
}

export function assessExperiment(spec, strategy, experiment, { approve = false, now = new Date() } = {}) {
  const config = spec.evolution;
  if (!config?.enabled) {
    throw new Error("This loop does not enable strategy evolution.");
  }
  if (experiment.loop !== spec.metadata.name) {
    throw new Error(`Experiment loop "${experiment.loop}" does not match spec loop "${spec.metadata.name}".`);
  }
  if (experiment.metric !== config.metric.name) {
    throw new Error(`Experiment metric "${experiment.metric}" does not match configured metric "${config.metric.name}".`);
  }
  if (experiment.baseline.version !== strategy.version) {
    throw new Error(
      `Experiment baseline version ${experiment.baseline.version} does not match current strategy version ${strategy.version}.`
    );
  }
  const baselineDigest = sha256Json(strategy);
  if (experiment.baseline.strategySha256 !== baselineDigest) {
    throw new Error("Experiment baseline strategySha256 does not match the active strategy digest.");
  }

  const candidate = experiment.candidate.strategy;
  const candidateDigest = sha256Json(candidate);
  if (experiment.candidate.strategySha256 !== candidateDigest) {
    throw new Error("Experiment candidate strategySha256 does not match the candidate strategy digest.");
  }
  if (candidate.loop !== spec.metadata.name) {
    throw new Error(`Candidate strategy loop "${candidate.loop}" does not match spec loop "${spec.metadata.name}".`);
  }
  if (candidate.version !== strategy.version + 1 || candidate.parentVersion !== strategy.version) {
    throw new Error(
      `Candidate strategy must be version ${strategy.version + 1} with parentVersion ${strategy.version}.`
    );
  }
  if (candidate.instructions.trim() === strategy.instructions.trim()) {
    throw new Error("Candidate strategy instructions must differ from the current strategy.");
  }

  const minimumSamples = config.metric.minimumSamples;
  if (experiment.baseline.samples < minimumSamples || experiment.candidate.samples < minimumSamples) {
    throw new Error(`Baseline and candidate each require at least ${minimumSamples} sample(s).`);
  }
  validateMatchedBenchmark(experiment);
  validateEvolutionEvaluator(config, experiment, now);

  assertUniqueCommandEvidence(experiment.evidence, "experiment evidence");
  for (const command of config.evaluator.commands) {
    const evidence = experiment.evidence.find((item) => item.command === command);
    if (!evidence) {
      throw new Error(`Missing evolution evidence for configured command: ${command}`);
    }
    if (evidence.exitCode !== 0) {
      throw new Error(`Evolution evidence command failed (${evidence.exitCode}): ${command}`);
    }
  }

  const improvement = config.metric.direction === "maximize"
    ? experiment.candidate.score - experiment.baseline.score
    : experiment.baseline.score - experiment.candidate.score;
  const candidatePassed = experiment.candidate.results.every((result) => result.verdict === "pass");
  const qualifies = improvement >= config.metric.minimumImprovement && candidatePassed;

  let outcome;
  if (!qualifies || experiment.recommendation === "reject") {
    outcome = "rejected";
  } else if (
    !approve &&
    (config.promotion.mode === "human-review" || experiment.recommendation === "needs-human")
  ) {
    outcome = "pending-review";
  } else {
    outcome = "promoted";
  }

  return {
    outcome,
    improvement,
    qualifies,
    candidatePassed,
    candidate,
    baselineVersion: strategy.version,
    candidateVersion: candidate.version
  };
}

function validateEvolutionEvaluator(config, experiment, now) {
  const configured = normalizeIdentity(config.evaluator.name);
  const candidateCreatedAt = experiment.candidate.strategy.createdAt === null
    ? null
    : parseEvolutionTimestamp(experiment.candidate.strategy.createdAt, "Candidate strategy createdAt");
  if (normalizeIdentity(experiment.evaluator.identity) !== configured) {
    throw new Error("Experiment evaluator identity must match evolution.evaluator.name.");
  }
  assertEvaluationTime(experiment.evaluator.evaluatedAt, now, "experiment evaluator", candidateCreatedAt);

  const benchmarkDigest = sha256Json({
    benchmark: experiment.benchmark,
    baseline: experiment.baseline,
    candidate: experiment.candidate
  });
  if (experiment.evaluator.benchmarkSha256 !== benchmarkDigest) {
    throw new Error("Experiment evaluator benchmarkSha256 does not bind the recorded benchmark arms.");
  }
  if (experiment.evaluator.evidenceSha256 !== sha256Json(experiment.evidence)) {
    throw new Error("Experiment evaluator evidenceSha256 does not bind the recorded evidence.");
  }

  for (const [armName, arm] of [["baseline", experiment.baseline], ["candidate", experiment.candidate]]) {
    const strategySha256 = armName === "baseline"
      ? experiment.baseline.strategySha256
      : experiment.candidate.strategySha256;
    for (const result of arm.results) {
      if (normalizeIdentity(result.evaluation.identity) !== configured) {
        throw new Error(`Benchmark case ${result.caseId} evaluator identity does not match evolution.evaluator.name.`);
      }
      assertEvaluationTime(result.evaluation.evaluatedAt, now, `benchmark case ${result.caseId}`, candidateCreatedAt);
      if (result.evaluation.arm !== armName || result.evaluation.strategySha256 !== strategySha256) {
        throw new Error(
          `Benchmark case ${result.caseId} evaluation must bind the ${armName} arm and its strategy digest.`
        );
      }
      assertUniqueCommandEvidence(result.evaluation.evidence, `benchmark case ${result.caseId} evidence`);
      for (const command of config.evaluator.commands) {
        const evidence = result.evaluation.evidence.find((item) => item.command === command);
        if (!evidence) {
          throw new Error(`Benchmark case ${result.caseId} is missing evaluator command evidence: ${command}`);
        }
        if (result.verdict === "pass" && evidence.exitCode !== 0) {
          throw new Error(`Passing benchmark case ${result.caseId} has failing command evidence: ${command}`);
        }
      }
    }
  }
}

function assertUniqueCommandEvidence(evidence, label) {
  const commands = evidence.map((entry) => entry.command);
  if (new Set(commands).size !== commands.length) {
    throw new Error(`${label} contains duplicate command evidence.`);
  }
}

function assertEvaluationTime(value, now, label, earliest = null) {
  const parsed = parseEvolutionTimestamp(value, `${label} evaluatedAt`);
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) throw new Error("Evolution assessment clock must be a valid Date.");
  if (parsed > nowMs + 5 * 60_000) throw new Error(`${label} evaluatedAt cannot be in the future.`);
  if (earliest !== null && parsed < earliest - 5 * 60_000) {
    throw new Error(`${label} evaluatedAt cannot predate the candidate strategy.`);
  }
}

function parseEvolutionTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`${label} is not a valid UTC timestamp.`);
  }
  return parsed;
}

function normalizeIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function validateMatchedBenchmark(experiment) {
  const expected = experiment.benchmark.caseIds;
  if (new Set(expected).size !== expected.length) {
    throw new Error("Benchmark caseIds must be unique.");
  }
  const baselineIds = experiment.baseline.results.map((result) => result.caseId);
  const candidateIds = experiment.candidate.results.map((result) => result.caseId);
  if (experiment.baseline.samples !== baselineIds.length || experiment.candidate.samples !== candidateIds.length) {
    throw new Error("Experiment samples must equal the number of recorded case results.");
  }
  if (!sameIds(expected, baselineIds) || !sameIds(expected, candidateIds)) {
    throw new Error("Baseline and candidate must evaluate the exact benchmark caseIds.");
  }
  const baselineScore = average(experiment.baseline.results.map((result) => result.score));
  const candidateScore = average(experiment.candidate.results.map((result) => result.score));
  if (Math.abs(baselineScore - experiment.baseline.score) > 1e-9) {
    throw new Error(`Baseline score must be mechanically derived from case results (${baselineScore}).`);
  }
  if (Math.abs(candidateScore - experiment.candidate.score) > 1e-9) {
    throw new Error(`Candidate score must be mechanically derived from case results (${candidateScore}).`);
  }
}

function sameIds(expected, actual) {
  return expected.length === actual.length && [...expected].sort().every((value, index) => value === [...actual].sort()[index]);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function runSucceeded(runLog) {
  return runLog.status === "passed" && runLog.results.length > 0 && runLog.results.every((result) => result.verdict === "pass");
}
