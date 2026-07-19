# Positioning: SuperLoop

Most users do not begin with a protocol. They begin with an idea such as “keep this repository healthy,” “track this market,” or “take this complex outcome from concept to a finished deliverable.” The first hard problem is not repetition; it is turning that idea into an observable goal, a safe authority boundary, and evidence that can prove whether the work helped.

SuperLoop turns a vague idea into a **high-quality, verifiable Goal Contract plus a suggested Loop structure**, then stops for human review before anything becomes executable.

```text
vague idea
  -> suitability route
  -> Goal Contract
  -> non-executable LoopProposal
  -> digest-bound human decision
  -> deterministic loop.yaml
  -> bounded discovery OR fixed Work Plan
  -> Part evidence + final Goal evidence
  -> measured strategy evolution, when justified
```

One sentence of positioning: **SuperLoop is the Agent Skill that compiles vague recurring or finite long-horizon intent into a reviewable, verifiable, and bounded agent loop.**

## Why the proposal layer matters

An ordinary agent often jumps from a request to action. That is tolerable for a bounded one-shot task and dangerous for recurring or unattended work. A vague phrase such as “improve quality” leaves the model to invent the metric, scope, stopping rule, and authority on every run.

`LoopProposal` makes those decisions visible before execution:

- the Goal Contract defines the observable outcome and acceptance evidence;
- non-goals prevent adjacent work from being absorbed;
- assumptions and at most three material questions expose uncertainty without creating an interview maze;
- the candidate loop defines bounded continuous discovery or a fixed finite Work Plan, worker isolation, independent Part and Goal evaluation, durable state, budgets, and gates;
- readiness distinguishes missing input from a design that is ready for human review;
- a human decision binds the exact proposal digest, so any edit requires review again.

The proposal is not a prompt and not permission. It is a design artifact. Evaluator evidence answers whether an output meets technical criteria; a human decision answers whether the exact design may become an executable contract.

The compiled contract remains reviewable: it persists the full Goal Contract and carries tamper-evident bindings for the proposal, candidate Loop body, Goal Contract, and reconstructable human approval. The original proposal and decision remain the complete audit artifacts. Direct `loop.yaml` authoring is reserved for a user-supplied existing contract or an explicit expert-path request; the agent cannot use it to bypass Proposal-first intake for a new vague idea.

## The conceptual stack

Recurring and finite long-horizon agent work benefit from loop design: instead of manually reconstructing a prompt for every round or losing progress between Parts, define a repeatable control loop around the prompt, its context, and its execution harness.

```text
idea -> goal -> proposal -> contract -> prompt -> context -> harness -> loop
```

The loop decides when and under what limits the layers beneath it run again. Scheduling, worktrees, skills, subagents, and external memory make that control surface practical, but repetition alone is not engineering. Objective, authority, evidence, state, and stop conditions require explicit contracts.

SuperLoop's bet: once loops become how recurring agent work gets done, the loop itself needs a **portable, reviewable, mechanically checkable contract**. That contract should not belong to one model or vendor.

## The protocol models a portable control cycle

After a proposal is approved and compiled, `loop.yaml` encodes the shared control actions plus an optional finite plan:

| Loop action | `loop.yaml` section | What the validator forces |
| --- | --- | --- |
| Plan (finite only) | `workPlan` | fixed Parts, acyclic dependencies, Part criteria/artifacts, optional Part-specific evidence/commands, per-run cap, independent Goal Gate |
| Discover | `discovery` | bounded sources, deterministic-first ranking, `maxItemsPerRun` |
| Hand off | `handoff` | isolation when write permissions exist |
| Verify | `verification` | independent evaluator, assume-broken stance, executable evidence needs commands |
| Persist | `persistence` | state, run logs, inbox, and decisions outside chat |
| Schedule | `schedule` + `safety` | cadence, timeout, budgets, retry caps, and human gates |

Common implementation pieces have SuperLoop counterparts: a manual GitHub Actions preflight scaffold, worktrees, rendered executor Skills, worker/evaluator subagents, and external memory in `state.json`, `inbox.md`, and `decisions.md`. Connectors remain the responsibility of the agent's own integration layer.

## What SuperLoop hardens

- **Intent debt**: the Goal Contract and proposal record what success, failure, and exclusion mean before the first run.
- **Verification debt**: the validator requires evaluator independence and evidence artifacts; a passing evaluator still does not bypass human authority.
- **Authority drift**: proposal approval is digest-bound, and external effects remain behind runtime gates.
- **Token and cost drift**: `safety.budgets` is enforced by planning and recording rather than left as prose.
- **Orchestration tax**: `maxItemsPerRun`, `maxDailyRuns`, and the inbox deliberately throttle work to review capacity.
- **Context loss**: state, evidence, and decisions survive outside chat and can reconstruct the next bounded run.
- **Completion drift**: finite Parts cannot unlock out of order, intermediate success cannot masquerade as whole-Goal completion, and the final Goal Gate is independently evidenced.
- **Strategy folklore**: improvement claims require matched benchmark cases, exact strategy attribution, independent evidence, and a promotion threshold.

The same shape can scale beyond a local script when deterministic gates, model-driven steps, durable evidence, and human decisions are composed into one reviewed pipeline. SuperLoop specifies that shape once and keeps it portable; it does not claim every workload should use it.

## Repetition versus improvement

A task loop repeats bounded work under one approved contract. A continuous Loop can discover new items; a finite Loop selects only dependency-ready approved Parts. Both evaluate evidence, persist failures, and retry within budgets. Finite work adds a final whole-Goal evaluation after every Part passes. This supports long-horizon work across resumable runs, but repetition alone does not make the agent better.

Strategy evolution is a separate controlled loop. It proposes one change to external task instructions, compares baseline and candidate on the same frozen cases, and promotes only measured improvement while preserving the Goal Contract, permissions, verification, budgets, and human gates. It does not train model weights and it does not authorize the system to rewrite its own controls.

The product therefore supports self-correction at two honest levels:

1. **task correction**: evaluator evidence produces a bounded retry, blocked state, or human-review item;
2. **strategy correction**: matched experiments may improve how future runs attempt the same approved goal.

## Honest boundaries

**A fixed Part graph is not a general orchestrator.** Protocol v1 can model a finite acyclic Work Plan and process only dependency-ready Parts, with a deterministic order and bounded concurrency. It does not support runtime-authored plan expansion, arbitrary distributed workflows, or silent scope changes; those require a new proposal revision or another orchestration layer.

**Long-running is not the same as one long process.** SuperLoop favors small, resumable iterations that land evidence and update state. It is a durable control system, not an endurance demonstration.

**Feedback quality limits self-correction.** A weak or gameable metric produces weak evolution. Independent evaluation, raw evidence, and matched cases reduce self-deception but cannot manufacture a valid success signal.

**Integrations remain real prerequisites.** A proposal can recommend a connector, credential, browser, repository, or data source; it cannot pretend the integration exists. Missing prerequisites keep the design at `needs-input` or block execution.

**The runner is not a security sandbox.** It uses current OS permissions. Minimum permissions, isolation, typed actions, and human gates remain mandatory.

**Human review is a control boundary, not decoration.** Proposal approval permits deterministic contract compilation. Merge, deployment, deletion, spending, external messaging, and permission changes still require their own explicit runtime decisions.

## Product direction

- **Current core**: canonical Skill, idea-to-goal proposal flow, digest-bound proposal decisions, deterministic contract compilation, continuous discovery, fixed finite Work Plans with Part and Goal Gates, evidence-bound evaluation, durable local execution, and measured strategy experiments.
- **Next**: provider-native executors, richer human gate files, scheduling, and worker rebuilding from durable state.
- **Later**: process-level checkpoint evidence and explicitly reviewed plan-transition tooling when real workloads require safe replanning.

SuperLoop is not a claim that loops solve everything. It is a claim that vague recurring or composite intent deserves a goal before it gets a loop, and every loop deserves a contract before it gets authority.
