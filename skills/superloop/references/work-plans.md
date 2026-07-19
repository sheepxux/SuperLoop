# Fixed Work Plans

Use this reference when a finite, composite outcome cannot be completed and evaluated in one bounded context. A Work Plan is a domain-neutral decomposition inside one Loop; it is not a collection of nested Loops.

## Contents

- [Core model](#core-model)
- [When to use a Work Plan](#when-to-use-a-work-plan)
- [Contract shape](#contract-shape)
- [Design Parts](#design-parts)
- [Execute Part by Part](#execute-part-by-part)
- [Run the final Goal Gate](#run-the-final-goal-gate)
- [Approval and scope changes](#approval-and-scope-changes)
- [Cross-domain examples](#cross-domain-examples)

## Core model

Use these terms consistently:

- **Loop**: the durable control system that owns the complete Goal Contract.
- **Work Plan**: the fixed approved decomposition of a finite outcome.
- **Part**: one bounded unit with dependencies, expected artifacts, and exact acceptance criteria.
- **Iteration**: one attempt to complete one eligible Part.
- **Part Gate**: independent evaluation of the active Part's exact acceptance criteria and expected artifacts.
- **Goal Gate**: independent evaluation of the integrated outcome against every exact Goal acceptance criterion.

A failed Part Gate causes a bounded retry of the same Part. It does not create a new Loop and does not unlock dependent Parts. Passing every Part Gate does not by itself complete the Loop; the Goal Gate must also pass. The evaluator artifact and run result bind the exact frozen Part-definition SHA-256; a retry cannot substitute a simpler Part, reinterpret its criteria, or reuse a judgment from another definition.

When a user asks to skip, defer, or reorder a failed Part, state both invariants explicitly: dependent Parts remain locked, and the Loop cannot be `completed` until every Part Gate plus the separate final Goal Gate pass.

## When to use a Work Plan

Use `workPlan.mode: finite` when all of these hold:

- the requested outcome is finite but spans multiple independently checkable deliverables;
- progress must survive context loss or process restart;
- later work depends on accepted earlier work;
- the integrated result needs a final whole-Goal review.

Do not add a Work Plan when one bounded execution can complete the request. Keep continuous monitors, triage queues, and recurring remediation on bounded discovery unless they also have a separate finite project outcome. Do not disguise an unknowable or endless plan as finite.

## Contract shape

Use the schema-defined field names:

```yaml
workPlan:
  mode: finite
  maxPartsPerRun: 1
  parts:
    - id: part-foundation
      title: Establish the approved foundation
      objective: Produce the durable inputs required by later Parts.
      dependsOn: []
      goalCriteria:
        - Every required Part produces its declared artifacts and passes independent evaluation.
      acceptanceCriteria:
        - id: part-foundation-artifacts
          statement: Required foundation artifacts are complete and internally consistent.
          evidence:
            - artifact-review
          passCondition: Every declared artifact exists and the independent evaluator reports no unresolved inconsistency.
      verification:
        requiredEvidence:
          - artifact-review
        commands: []
      expectedArtifacts:
        - id: foundation-package
          description: Durable foundation package used by dependent Parts.
  completion:
    evaluator: goal-evaluator
    independent: true
    requiredEvidence:
      - artifact-review
    commands: []
    maxAttempts: 2
```

`goalCriteria` entries are exact strings copied from `goal.acceptanceCriteria`; they explain which whole-Goal criteria the Part advances. They do not replace Part acceptance criteria or imply that an intermediate Part satisfies the whole Goal.

Use `maxPartsPerRun: 1` for strictly sequential progress. A higher value bounds multiple already eligible Parts in one run; it never permits a locked Part or bypasses dependency checks.

## Design Parts

For every Part:

1. Assign a stable ID that describes its role, not a transient attempt number.
2. Define one bounded objective and one or more durable expected artifacts.
3. List explicit `dependsOn` IDs. Use a linear chain for ordered work; use a small acyclic dependency graph only when branches are genuinely independent.
4. Trace the Part to at least one exact whole-Goal criterion through `goalCriteria`.
5. Define acceptance criteria whose evidence and pass conditions can be checked without hidden chat context. When Parts need different forms of proof, add that Part's optional `verification.requiredEvidence` and `verification.commands`; otherwise it inherits the Loop-level verification envelope.
6. Keep the Part inside the Loop's approved permissions, budgets, non-goals, and human gates.

Eligible failed retries are scheduled before untouched Parts so correction stays on the same frozen definition. Within the retry and untouched classes, array order is the deterministic tie-breaker when multiple Parts are dependency-ready. Do not use prose such as “do the sensible next step” as an ordering rule.

The Work Plan is ready for review only when Part IDs are unique, dependencies exist and are acyclic, every Part can reach completion, required artifacts are explicit, the configured completion evaluator differs from the worker, and the final evaluation runs in a fresh context rather than a Part-evaluation context.

## Execute Part by Part

`loopctl next` is authoritative. For a finite plan it reports:

- `phase`: `work`, `goal-evaluation`, or `completed`;
- `eligibleParts`: Parts the current state permits, including each exact `partDefinitionSha256`;
- `lockedParts`: Parts whose dependencies have not passed;
- `retryQueue`: failed eligible Parts that still have retry budget.

In `work` phase:

1. Prefer an eligible retry before untouched work.
2. Select only an ID and digest returned in `eligibleParts`.
3. Give one worker the exact Part definition, allowed context, and expected artifact list.
4. Give a fresh Part evaluator the Part definition, artifact references and digests, worker notes, and the effective verification envelope. A declared Part `verification` overrides the Loop-level evidence/commands for that Part only; omission inherits the Loop-level envelope for compatibility.
5. Pass the Part Gate only when every exact Part criterion, every effective evidence item/command, and every expected artifact ID, reference, and digest passes. Each reference must resolve to a distinct, run-specific regular-file snapshot inside the Loop directory, and the runtime must recompute an exact SHA-256 match before accepting it. Never overwrite or delete an accepted snapshot: edit a separate working file and emit a new snapshot for every corrected attempt. For an externally hosted deliverable, retain a durable local export or receipt as the bound artifact.
6. Persist the result before asking for the next phase. A dependent Part remains locked until the pass is recorded.

The worker may revise its own draft before evaluation, but it never issues the terminal verdict. A failed evaluator result must identify a bounded correction for the same Part. Retry exhaustion follows the Loop's existing failure policy.

`blocked` and `needs-human` are durable terminal states for that attempt. `loopctl resume` only clears a scheduling pause; it does not change a Part verdict. After the missing prerequisite or human decision is actually resolved, an operator may run:

```bash
loopctl part reopen <loop-dir> --id <part-id> --actor <human> --reason <text>
```

The resolution record binds the exact blocking run and preserves actor, reason, and time. It can reopen only a `blocked` or `needs-human` Part, never a failed Part whose retry budget is exhausted.

## Run the final Goal Gate

When all required Parts have passed, `loopctl next` returns `phase: goal-evaluation`. In this phase:

- do not discover work, invoke a Part worker, or modify the approved plan;
- evaluate the integrated artifact set with `workPlan.completion.evaluator` in an independent context;
- require `workPlan.completion.requiredEvidence` and `commands` to cover the full approved `verification` envelope; executable evidence cannot be claimed without a configured command;
- cover every exact `goal.acceptanceCriteria` statement with a recorded verdict;
- bind the evaluation to the runtime-provided `basisSha256`, which represents the approved Goal Contract plus the passed Part definitions and artifact digests;
- record affected Part IDs when a failed whole-Goal criterion requires rework.

A passing Goal Gate changes the phase to `completed`. A failed Goal Gate reopens only affected roots whose `goalCriteria` trace to the failed whole-Goal criteria, plus their descendants. A blocked or `needs-human` Goal Gate stops for the declared prerequisite or authority decision. After that condition is genuinely resolved, use `loopctl goal resolve <loop-dir> --actor <human> --reason <text>` to bind the resolution to the exact Goal-evaluation run; generic `resume` is insufficient. `completed` is terminal and non-runnable.

## Approval and scope changes

The Work Plan is part of the candidate Loop body, so the exact proposal decision binds its Parts, order, dependencies, artifacts, criteria, bounds, and completion policy. Proposal approval authorizes deterministic compilation only; it does not bypass per-action human gates.

During execution, do not add, remove, reorder, split, merge, or reinterpret Parts. Do not change dependencies, expected artifacts, Part criteria, or the Goal Gate. If execution reveals a material scope gap:

1. stop and persist the blocker and current evidence;
2. revise the proposal with an exact parent digest;
3. obtain a new human decision for the changed proposal;
4. compile and validate the new contract before resuming through a supported state transition.

Until a reviewed state-migration path exists, do not carry a prior `pass` into a changed Part merely because its ID is unchanged. Repetition and correction inside an unchanged Part are runtime state; changing what the Part means is contract revision.

## Cross-domain examples

The protocol stays identical across domains:

| Outcome | Example Parts | Goal Gate |
| --- | --- | --- |
| Long-form artifact | structure → bounded sections → integrated revision | completeness, continuity, and whole-artifact acceptance |
| Software delivery | specification → verified vertical slices → integration | build, behavior, non-regression, and approved acceptance |
| Research result | questions → source packets → synthesis | source traceability, contradiction review, and conclusion support |
| System migration | inventory → mapping → rehearsal → bounded waves | post-migration integrity, rollback evidence, and approved completion |

These are examples of the same Work Plan abstraction, not separate Skills. Evidence identifiers are extensible typed names, and each Part may declare its own checks; domain-specific tools may be invoked inside the bounded worker/evaluator boundary. The Goal, Parts, dependencies, Part Gates, persistence, authority, and final Goal Gate remain the same.
