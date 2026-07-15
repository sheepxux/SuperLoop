# Idea to Loop

Use this workflow in **Propose** mode. Convert an underspecified idea into a reviewable design without granting execution authority.

## Contents

- [Deliverable boundary](#deliverable-boundary)
- [1. Preserve and route the idea](#1-preserve-and-route-the-idea)
- [2. Ask only material questions](#2-ask-only-material-questions)
- [3. Write a verifiable Goal Contract](#3-write-a-verifiable-goal-contract)
- [4. Choose the execution shape and recommend the candidate loop](#4-choose-the-execution-shape-and-recommend-the-candidate-loop)
- [5. Keep evidence and authority separate](#5-keep-evidence-and-authority-separate)
- [6. Preserve traceability](#6-preserve-traceability)
- [7. Stop for human confirmation](#7-stop-for-human-confirmation)
- [8. Compile deterministically](#8-compile-deterministically)
- [Compact example](#compact-example)

## Deliverable boundary

Produce a `LoopProposal`, not `loop.yaml` and not a running loop. The proposal contains two linked views:

1. a **Goal Contract** that defines the observable result and the evidence needed to judge it;
2. a **candidate loop** that recommends how bounded work could pursue and verify that goal.

Start from [the proposal template](../assets/proposal.yaml). It is intentionally a `needs-input` teaching artifact with an unconfirmed assumption and unmet prerequisite, not a ready proposal to approve. A proposal is safe to inspect, revise, and reject. It does not authorize external actions, scheduling, scaffolding, or execution.

## 1. Preserve and route the idea

Record the user's idea without silently strengthening it. Classify it as `one-shot`, `deterministic`, `agentic-loop`, or `unsafe-loop`.

- Route one-shot work to direct execution.
- Route deterministic work to a script, job, query, alert, or existing scheduler.
- Continue with an agentic-loop proposal when recurring judgment adds value or a finite composite outcome needs durable, independently verified progress across multiple Parts.
- Keep unsafe-loop readiness at `needs-input` until human gates and authority boundaries make the candidate safe enough to review; otherwise mark it `not-applicable`.

Do not infer that vague work is recurring. Do not infer that recurring work needs an agent.

## 2. Ask only material questions

Ask zero to three questions. A question is material only when its answer changes at least one of:

- the outcome or acceptance evidence;
- the eligible unit of work or discovery boundary;
- continuous discovery versus a finite Work Plan, including dependencies and final completion evidence;
- permissions, external effects, or human authority;
- time, item, retry, or cost budgets;
- a prerequisite integration, credential, source, or evaluator.

Prefer one compact batch over a long interview. When a safe default exists, record it in `assumptions` and continue. State the impact of each assumption and whether a human must confirm it. Never assume permission for merge, deployment, deletion, spending, external messaging, or permission changes.

Use `needs-input` when a missing answer prevents a safe or verifiable design. Use `ready-for-review` only when questions are resolved, a human has explicitly confirmed or rejected every design-shaping assumption, and every required prerequisite has been verified as met. Do not change an assumption or prerequisite status merely to clear validation. Use `not-applicable` when a smaller mechanism is the correct outcome.

## 3. Write a verifiable Goal Contract

Define an outcome, not an activity. Replace phrases such as “keep improving,” “make it high quality,” or “monitor everything” with observable state and bounded evidence.

Include:

- **objective**: one desired state the loop can advance;
- **acceptance criteria**: stable criteria that name inspectable evidence and a judging method;
- **non-goals**: tempting work the loop must not absorb;
- **stop conditions**: conditions that end or pause normal operation;
- **blocked conditions**: missing inputs, integrations, evidence, or authority that prevent valid progress.

Check each acceptance criterion with four questions:

1. What exact artifact or observation proves or disproves it?
2. Who or what evaluates that evidence?
3. Can the result be reproduced without hidden chat context?
4. Can a failed result produce a bounded next action?

If any answer is missing, keep the proposal at `needs-input` or narrow the objective.

## 4. Choose the execution shape and recommend the candidate loop

Describe the smallest loop that can pursue the Goal Contract. Keep the candidate complete enough to compile after approval, but do not execute it.

Choose exactly one primary execution shape:

- **continuous discovery**: bounded sources produce recurring eligible items; normal stop conditions end each run but the Loop has no fabricated finite completion;
- **finite Work Plan**: one Loop owns the complete Goal while a fixed, approved dependency graph of Parts advances it to a final Goal Gate. Read [fixed work plans](work-plans.md).

Do not treat a finite long-horizon request as one-shot merely because it was expressed in one message. Do not create a separate Loop for each Part.

For both shapes, define:

- **unit of work**: one stable item per worker boundary;
- **discovery**: named sources, deterministic filters, stable IDs, and a per-run cap;
- **handoff**: isolation, minimum permissions, and durable worker output;
- **verification**: an evaluator independent from the worker, assume-broken stance, evidence commands or artifacts, and valid verdicts;
- **persistence**: state, runs, evidence, inbox, and decisions outside chat;
- **schedule**: manual first, then the least frequent justified cadence;
- **budgets**: item, run, time, retry, and cost limits;
- **human gates**: every irreversible or high-impact action;
- **prerequisites**: tools, data, credentials, connectors, and ownership needed before execution;
- **evolution boundary**: whether strategy experimentation is useful and which external metric could compare matched cases.

For a finite Work Plan, also define stable Part IDs, exact dependencies, expected artifacts, Part-level acceptance criteria, optional Part-specific evidence/command envelopes, `maxPartsPerRun`, and an independent completion evaluator. Part criteria judge one bounded output; the final Goal Gate alone judges every exact Goal acceptance criterion across the integrated result. Keep readiness at `needs-input` when the decomposition or final evidence still depends on a material answer.

`needs-input` describes authority/readiness, not permission to submit a vague skeleton. When the user's idea already identifies observable stages, create a concrete provisional candidate from those facts: stable non-placeholder IDs, exact edges, durable artifacts, criterion statements, pass conditions, and effective verification. Preserve unknown domain details as blocking questions or labeled assumptions. For a continuous candidate, always propose numeric provisional caps for the approved-source allowlist size, items per run, runtime, cost per run, and retries; if no source has been approved, declare discovery blocked rather than leaving the source boundary open. For finite work, the review packet must also say that a material plan change needs a parent-linked revision, new digest-bound human decision, compilation, validation, and supported state migration before execution resumes; prior Part passes do not automatically carry over.

Recommend `evolution.enabled: false` when there is no stable benchmark or external outcome metric. Repetition alone is task execution, not strategy improvement.

## 5. Keep evidence and authority separate

An evaluator answers, “Does the candidate output satisfy the technical acceptance criteria, based on this evidence?” A human decision answers, “May this exact proposal become an executable contract?”

An evaluator verdict never supplies user consent. A human approval never makes weak technical evidence pass. Require both at their respective boundaries.

## 6. Preserve traceability

Give the proposal a stable `metadata.id` and monotonic `metadata.revision`. When revising a proposal, bind `metadata.parentProposalSha256` to the exact prior proposal. Trace each candidate-contract decision back to the Goal Contract, a question answer, an assumption, a prerequisite, or a safety invariant. For a finite plan, every Part must trace to exact `goal.acceptanceCriteria` strings, and the candidate Loop digest must cover the entire Work Plan.

Validate before review:

```bash
loopctl proposal validate proposal.yaml
```

Report validation output exactly. Do not describe an invalid proposal as ready.

## 7. Stop for human confirmation

Present a concise review packet:

1. suitability route and why;
2. Goal Contract;
3. execution shape, candidate loop, and initial manual-run boundary;
4. for finite work, Part order/dependencies, expected artifacts, every Part Gate, and the final Goal Gate;
5. assumptions, unresolved questions, and prerequisites;
6. high-impact actions and their human gates;
7. readiness and the next bounded action.

Then stop. Do not create `loop.yaml`, initialize a directory, enable a schedule, or run an executor merely because readiness is `ready-for-review`.

Record the human's decision against the exact proposal digest. Use [the proposal-decision template](../assets/proposal-decision.json) as the artifact shape, or let `loopctl` write it:

```bash
loopctl proposal decide proposal.yaml \
  --approve \
  --actor <human> \
  --reason <text> \
  --out decision.json
```

The local CLI does not authenticate identity. `actorType: human` and `actor` are audit assertions supplied by the operator, not proof that a human reviewed the file. Never run the approval command merely because an agent can access the terminal; systems requiring enforceable approval must place it behind an identity-backed human workflow.

Use `--request-changes --change <text>` for a revision request or `--reject` when the design should not proceed. Start revisions from the rejected or change-requested proposal and retain the parent digest.

Create a linked revision with the CLI, edit the new file without overwriting its parent, and supply that exact parent at every later boundary:

```bash
loopctl proposal revise proposal-v1.yaml --out proposal-v2.yaml
# Apply the requested changes and reconcile assumptions, prerequisites, blockers, and readiness.
loopctl proposal validate proposal-v2.yaml --parent proposal-v1.yaml
loopctl proposal decide proposal-v2.yaml --parent proposal-v1.yaml \
  --approve --actor <human> --reason <text> --out decision-v2.json
```

Revision 2 and later must include `--parent`; a wrong, changed, or missing parent fails lineage validation. Revision 1 must not include one.

## 8. Compile deterministically

Compile only an approved, digest-matched, `ready-for-review` proposal:

```bash
loopctl proposal compile proposal.yaml \
  --decision decision.json \
  --out loop.yaml
```

For revision 2 and later, also pass `--parent <exact-parent-proposal.yaml>` to `proposal compile`.

Compilation maps the approved candidate contract into `loop.yaml`; it must not reinterpret prose, invent permissions, resolve open questions, widen bounds, or rewrite a Work Plan. It also persists the complete Goal Contract as `goalContract`. Provenance binds the full proposal digest, approved candidate Loop body digest—including every Work Plan Part and Goal Gate—Goal Contract digest, and all fields needed to reconstruct and verify the human approval digest. Validation recomputes those bindings, so a digest-inconsistent change to the compiled Goal Contract, Loop body, or retained approval is detected. Retain the original proposal and decision artifacts as the complete review trail and trusted comparison point; local hashes are not a signature. If compilation needs judgment, return to Propose mode, increment the revision, and request a new digest-bound decision.

After compilation, validate `loop.yaml` and review the generated diff before Scaffold or Run mode. Initialize it only with a name exactly equal to `loop.yaml.metadata.name` and `--out .loop-engineering/loops`; the approved persistence layout must remain `.loop-engineering/loops/<name>/{state.json,runs/,inbox.md,decisions.md}`. A rename or relocation requires proposal revision and approval.

Direct `loop.yaml` authoring remains available only when the user supplies an existing contract or explicitly requests expert direct authoring. It must satisfy the same contract invariants. Never choose that path unilaterally for a vague or new idea.

## Compact example

Vague idea: “Keep our repository healthy and improve the code automatically.”

Good proposal behavior:

- ask which observable repository-health signals matter, what changes may be drafted, and who may authorize merge;
- assume a manual cadence and draft-only changes when safe;
- define evidence such as reproducible tests, type checks, and dependency audit output;
- recommend bounded issue discovery, one isolated patch per item, an independent evaluator, durable state, and human-only merge;
- keep strategy evolution disabled until matched historical cases and a stable success metric exist;
- stop at `ready-for-review` for human confirmation.

Bad proposal behavior:

- translate “improve” into an endless autonomous refactor loop;
- let the worker decide that its own patch is correct;
- call a green evaluator verdict permission to merge;
- scaffold or schedule before the proposal digest is approved.

Finite composite idea: “Take this outcome from an initial concept to a complete, independently reviewed deliverable.”

Good proposal behavior:

- keep one Loop and one Goal Contract for the whole outcome;
- draft a fixed Work Plan whose Parts have stable IDs, explicit dependencies, durable expected artifacts, and their own evidence-bearing Part Gates;
- configure one independent final Goal Gate that checks every whole-Goal acceptance criterion only after all Parts pass;
- make scope changes require a new proposal revision instead of silently appending work during execution.
