import assert from "node:assert/strict";
import test from "node:test";
import { readData } from "../src/fs-utils.js";
import { validateData, validateLoopSpec } from "../src/validation.js";

function finiteSpec() {
  const spec = structuredClone(readData("examples/ci-triage/loop.yaml"));
  const [firstGoalCriterion, ...remainingGoalCriteria] = spec.goal.acceptanceCriteria;
  spec.discovery.maxItemsPerRun = 1;
  spec.safety.budgets.maxItemsPerRun = 1;
  spec.workPlan = {
    mode: "finite",
    maxPartsPerRun: 1,
    parts: [
      {
        id: "prepare-input",
        title: "Prepare the bounded input",
        objective: "Produce the first bounded and independently inspectable artifact.",
        dependsOn: [],
        goalCriteria: [firstGoalCriterion],
        acceptanceCriteria: [
          {
            id: "criterion-prepared",
            statement: "The bounded input is complete and reviewable.",
            evidence: ["diff-review"],
            passCondition: "Independent diff review confirms the declared boundary."
          }
        ],
        expectedArtifacts: [
          { id: "prepared-input", description: "A digest-bound bounded input artifact." }
        ]
      },
      {
        id: "integrate-output",
        title: "Integrate the final output",
        objective: "Combine the approved input into the complete verified deliverable.",
        dependsOn: ["prepare-input"],
        goalCriteria: remainingGoalCriteria,
        acceptanceCriteria: [
          {
            id: "criterion-integrated",
            statement: "The integrated output passes the configured checks.",
            evidence: ["tests", "diff-review"],
            passCondition: "All configured commands pass and the final diff is independently reviewed."
          }
        ],
        expectedArtifacts: [
          { id: "integrated-output", description: "The complete verified output artifact." }
        ]
      }
    ],
    completion: {
      evaluator: "goal-evaluator",
      independent: true,
      requiredEvidence: [...spec.verification.requiredEvidence],
      commands: [...spec.verification.commands],
      maxAttempts: 2
    }
  };
  return spec;
}

test("a domain-neutral finite Work Plan validates without changing legacy Loop shape", () => {
  const finite = validateLoopSpec(finiteSpec(), "finite plan");
  assert.equal(finite.ok, true, finite.errors.join("\n"));

  const legacy = validateLoopSpec(readData("examples/ci-triage/loop.yaml"), "legacy loop");
  assert.equal(legacy.ok, true, legacy.errors.join("\n"));
});

test("Work Plan dependencies must exist and remain acyclic", () => {
  const unknown = finiteSpec();
  unknown.workPlan.parts[1].dependsOn = ["missing-part"];
  let result = validateLoopSpec(unknown);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /depends on unknown part/);

  const self = finiteSpec();
  self.workPlan.parts[0].dependsOn = ["prepare-input"];
  result = validateLoopSpec(self);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /cannot depend on itself/);

  const cycle = finiteSpec();
  cycle.workPlan.parts[0].dependsOn = ["integrate-output"];
  result = validateLoopSpec(cycle);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /acyclic graph/);
});

test("Work Plan parts must cover only approved Goal criteria with effective Part evidence", () => {
  const unknownGoal = finiteSpec();
  unknownGoal.workPlan.parts[0].goalCriteria = ["An unapproved goal criterion."];
  let result = validateLoopSpec(unknownGoal);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unknown goal criterion|do not cover goal criterion/);

  const undeclaredEvidence = finiteSpec();
  undeclaredEvidence.workPlan.parts[0].acceptanceCriteria[0].evidence = ["artifact-review"];
  result = validateLoopSpec(undeclaredEvidence);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /requires evidence.*missing from the effective verification envelope/);

  const heterogeneous = finiteSpec();
  heterogeneous.workPlan.parts[0].acceptanceCriteria[0].evidence = ["source-trace-review"];
  heterogeneous.workPlan.parts[0].verification = {
    requiredEvidence: ["source-trace-review"],
    commands: []
  };
  result = validateLoopSpec(heterogeneous);
  assert.equal(result.ok, true, result.errors.join("\n"));

  const executableWithoutCommand = finiteSpec();
  executableWithoutCommand.workPlan.parts[0].acceptanceCriteria[0].evidence = ["tests"];
  executableWithoutCommand.workPlan.parts[0].verification = {
    requiredEvidence: ["tests"],
    commands: []
  };
  result = validateLoopSpec(executableWithoutCommand);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Part "prepare-input" requires at least one command/);
});

test("the final Goal evaluator is a distinct role from both worker and Part evaluator", () => {
  const sameAsPartEvaluator = finiteSpec();
  sameAsPartEvaluator.workPlan.completion.evaluator = sameAsPartEvaluator.verification.evaluator;
  let result = validateLoopSpec(sameAsPartEvaluator);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /independent from verification\.evaluator/);

  const sameAsWorker = finiteSpec();
  sameAsWorker.workPlan.completion.evaluator = sameAsWorker.handoff.worker;
  result = validateLoopSpec(sameAsWorker);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /independent from handoff\.worker/);
});

test("the final Goal Gate cannot weaken approved evidence or command requirements", () => {
  const missingEvidence = finiteSpec();
  missingEvidence.workPlan.completion.requiredEvidence = missingEvidence.workPlan.completion.requiredEvidence
    .filter((entry) => entry !== "tests");
  let result = validateLoopSpec(missingEvidence);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /completion\.requiredEvidence.*tests/);

  const missingCommand = finiteSpec();
  missingCommand.workPlan.completion.commands = [];
  result = validateLoopSpec(missingCommand);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /completion\.commands.*verification command|executable Goal evidence/);
});

test("Goal evaluation schema carries an independent completion basis", () => {
  const result = validateData("goal-evaluation", {
    apiVersion: "loop-engineering/v1",
    loop: "finite-loop",
    basisSha256: "a".repeat(64),
    evaluator: {
      identity: "goal-evaluator",
      contextId: "fresh-goal-context",
      evaluatedAt: "2026-07-15T12:00:00Z"
    },
    verdict: "pass",
    criteria: [
      { statement: "The complete Goal criterion is satisfied.", verdict: "pass", summary: "Verified." }
    ],
    evidence: [{ type: "artifact-review", summary: "Integrated artifacts were reviewed." }],
    reasons: [],
    affectedParts: [],
    nextAction: "complete"
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
});
