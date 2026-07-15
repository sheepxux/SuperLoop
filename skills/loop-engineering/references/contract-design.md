# Contract Design

Use [the proposal template](../assets/proposal.yaml) for a new or vague idea and [the loop contract template](../assets/loop.yaml) for the executable contract. Validate with `loopctl proposal validate` and `loopctl validate` respectively.

## Contents

- [Entry paths](#entry-paths)
- [Goal Contract decisions](#goal-contract-decisions)
- [Candidate-contract decisions](#candidate-contract-decisions)
- [Mechanical transition](#mechanical-transition)
- [Review order](#review-order)

## Entry paths

Prefer the reviewed proposal path:

```text
LoopProposal
  -> exact proposal SHA-256
  -> human LoopProposalDecision
  -> deterministic compile
  -> loop.yaml
```

Compile only when readiness is `ready-for-review`, the decision says `approve`, and the decision binds the exact proposal digest. Reject stale or change-requested decisions. Do not add assumptions, permissions, scope, or integrations during compilation; revise the proposal and request a new decision instead.

Directly authoring `loop.yaml` remains an expert and backward-compatible path only when the user supplies an existing contract or explicitly asks for direct authoring. An agent must not select it unilaterally for a vague or new idea. Record the user's choice explicitly and apply every invariant below.

## Goal Contract decisions

Before mapping a proposal into the runtime contract:

- preserve one observable objective rather than an activity;
- preserve acceptance criteria and their inspectable evidence;
- preserve non-goals so the loop cannot absorb adjacent work;
- separate normal completion, blocked conditions, and unsafe conditions;
- resolve or explicitly preflight every required prerequisite;
- keep question answers, assumptions, and candidate decisions traceable to the approved proposal revision.

An evaluator judges technical evidence. A human grants authority. Never substitute one boundary for the other.

## Candidate-contract decisions

### Metadata and goal

- Give the loop a stable lowercase name and an accountable owner.
- Carry the approved objective and acceptance evidence forward unchanged.
- Persist the complete approved Goal Contract in `goalContract` and bind the compiled result to the proposal, candidate Loop body, Goal Contract, and reconstructable human-decision digests.
- Fail compilation instead of inventing a value that the proposal did not settle.

### Discovery

- Name each source and the bounded query or command.
- Prefer deterministic filtering before model ranking.
- Assign stable item IDs and cap items per run.
- Decide how deduplication and previously failed items work.

### Fixed Work Plan

Use `workPlan.mode: finite` when one approved Goal requires multiple durable Parts. Keep continuous streams on discovery. For finite work:

- preserve one Loop and one Goal Contract for the whole outcome;
- assign stable Part IDs, explicit acyclic dependencies, exact whole-Goal trace strings, expected artifacts, evidence-bearing Part acceptance criteria, and Part-specific verification envelopes when checks differ across Parts;
- set `maxPartsPerRun` to the smallest useful bound, normally `1` for strictly sequential work;
- configure an independent `workPlan.completion.evaluator`, required evidence, commands, and bounded attempts;
- treat Part evaluation and Goal evaluation as different gates: Part Gates unlock dependencies, while the final Goal Gate alone completes the Loop;
- make the approved plan immutable during execution. Stop and create a proposal revision when Part meaning, order, dependencies, artifacts, criteria, or completion policy changes.

Read [fixed work plans](work-plans.md) for the field shape and runtime phases.

### Handoff

- Use the smallest declared write boundary that fits the task: worktree or branch for repository work, task-directory for file deliverables, thread/context plus durable artifact paths for agent work, or an equivalent isolated process.
- List explicit permissions; omit permissions that are not required.
- Make one worker responsible for one item.
- Require a durable result and worker notes.

### Verification

- Use a role and context independent from the worker.
- Start from `assume-broken`.
- Require artifact-specific evidence: tests, type checks, screenshots, DOM assertions, query results, source citations, or diff review.
- Permit `pass`, `fail`, `blocked`, and `needs-human`; treat missing evidence as non-pass.
- Route authority decisions to human gates even after an evaluator passes the work.

### Persistence

Keep the immutable contract and mutable state separate:

```text
.loop-engineering/loops/<name>/
├── loop.yaml
├── state.json
├── strategy.json          # only when evolution is enabled
├── inbox.md
├── decisions.md
├── experiments/
└── runs/
```

Never place safety policy in `strategy.json`. Never use chat history as the only state store.

### Schedule and runtime

Start manually. Add a cadence only after one complete manual run produces valid evidence. Define timezone, timeout, concurrency, retry, and recovery behavior.

### Safety

Set item, run, time, retry, and cost limits. Use typed action IDs where possible. Route merge, deploy, deletion, spending, external messaging, and permission changes to human-only gates.

### Evolution

Enable strategy evolution only when a stable external metric and matched benchmark cases exist. Keep the Goal Contract, candidate bounds, permissions, verification policy, and safety gates immutable. Evolve only strategy instructions.

## Mechanical transition

Use the digest-bound decision and deterministic compiler:

```bash
loopctl proposal decide proposal.yaml \
  --approve \
  --actor <human> \
  --reason <text> \
  --out decision.json

loopctl proposal compile proposal.yaml \
  --decision decision.json \
  --out loop.yaml

loopctl validate loop.yaml
```

For revision 2 and later, pass the exact prior proposal as `--parent <parent-proposal.yaml>` to validation, decision, and compilation. After validation, initialize a proposal-compiled contract only with `loopctl init <exact-metadata.name> --from loop.yaml --out .loop-engineering/loops`; initialization must not rename the contract or relocate its reviewed persistence fields.

Review the compiled diff even when validation passes. Mechanical validity does not prove that the human approved the right objective or that integrations work in the target environment.

## Review order

Review in this order:

1. proposal and decision digest binding;
2. unsafe or ungranted authority;
3. changed objective, evidence, non-goals, or fixed Work Plan;
4. unresolved questions and prerequisites;
5. missing stop or blocked conditions;
6. self-evaluation;
7. unbounded discovery, invalid Part dependencies, or a missing final Goal Gate;
8. missing persistence or unenforced budgets;
9. clarity and style.
