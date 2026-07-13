# Positioning: Loop-Engineering

Recurring agent work benefits from loop design: instead of manually reconstructing a prompt for every round, define a repeatable control loop around the prompt, its context, and its execution harness. This project uses the following conceptual stack:

```text
prompt -> context -> harness -> loop
```

The loop decides when and under what limits the layers beneath it run again. Scheduling, worktrees, skills, subagents, and external memory make that control surface practical, but repetition alone is not engineering: the objective, authority, evidence, state, and stop conditions still need explicit contracts.

Loop-Engineering's bet: once loops become how recurring agent work gets done, the loop itself needs a **portable, reviewable, mechanically checkable contract**. That contract should not belong to any one vendor. Loop-Engineering is that contract plus the tooling that makes it enforceable.

## The protocol models five loop actions

`loop.yaml` encodes five required actions:

| Loop action | `loop.yaml` section | What the validator forces |
| --- | --- | --- |
| Discover | `discovery` | Bounded sources, deterministic-first ranking, `maxItemsPerRun` |
| Hand off | `handoff` | Isolation (worktree) whenever write permissions exist |
| Verify | `verification` | Independent evaluator, assume-broken stance, executable evidence needs commands |
| Persist | `persistence` | State, run logs, inbox, decisions — all outside chat |
| Schedule | `schedule` + `safety` | Cadence, timeout, budgets, retry caps, human gates |

Common implementation pieces also have Loop-Engineering counterparts: a manual GitHub Actions preflight scaffold (not a scheduled executor), worktrees (`handoff.worktree`), skills (rendered executor playbooks), connectors (left to the agent's own MCP tooling), worker/evaluator subagents (rendered prompts), and external memory (`state.json`, `inbox.md`, `decisions.md`).

## What Loop-Engineering hardens that prose loops leave soft

Recurring loop-design costs include:

- **Intent debt** (every run cold-starts and guesses the house rules): the rendered executor skill is written once and read every run; the spec carries objective, acceptance criteria, and stop conditions so the agent does not re-derive them.
- **Verification debt** (unattended loops fail unattended): the validator rejects specs without an independent evaluator; the evaluator result is schema-checked (`loopctl check evaluator`); "done" still requires a human at the `needsReview`/`humanOnly` gates.
- **Token cost control**: `safety.budgets` is not advice — `loopctl next` refuses the run when the daily budget is spent, and `loopctl record` keeps the counters.
- **Orchestration tax** (parallelism is capped by human review bandwidth, not by tooling): `maxItemsPerRun`, `maxDailyRuns`, and the inbox are deliberate throttles. Keeping loops small is a feature.
- **Comprehension debt and cognitive surrender** (code nobody read, judgment quietly handed over): no protocol can absorb these. Loop-Engineering's contribution is to keep every run auditable without chat history — run logs, evidence, and decisions live in files a human can read later.

The same shape can scale beyond a local script when deterministic gates, model-driven steps, durable evidence, and human decisions are composed into one reviewed pipeline. Loop-Engineering specifies that shape once and keeps it portable across agents; it does not claim that every workload should use it.

## Honest boundaries

The practical limitations of loop-based work are part of the product boundary, not objections to hide.

**Loops are overrated where topology is underrated.** Feedback-dense, single-goal tasks — CI triage, dependency updates, QA passes — are well served by a simple loop, and they are the use case v1 targets. Genuinely hard work may be a graph of deeply coupled subtasks where earlier mistakes compound. Protocol v1 deliberately models a single-lane loop: discover a bounded set of items and process them one at a time. It does not model dependency graphs between items, and it should not pretend to. If that expressiveness comes later, it is a protocol extension, not a rendering trick.

**Long-running is not the same as hard.** Loop-Engineering optimizes for small, bounded, resumable iterations that land evidence and update state, not for uninterrupted endurance demonstrations. The budgets exist to force that shape.

**Feedback is the loop's lifeline; signal density beats communication density.** A loop with only end-of-run verdicts may discover problems too late. Today Loop-Engineering's evaluator verdict is outcome-level, per item. Process-level signals such as rejectable mid-run checkpoints are a possible later protocol extension, noted in the roadmap.

**Multi-agent systems stay healthier by rebuilding context from durable state instead of accumulating chat indefinitely.** Earlier errors can compound, and self-review can amplify them. Loop-Engineering keeps state outside the model, starts each run from `state.json`, and separates evaluator context from worker context. The local Runner preserves that substrate; provider-native worker rebuilding remains a later extension.

**Model self-improvement is unproven; measurable strategy evolution is narrower.** Loop-Engineering does not claim loops make models better. It makes work *accumulate*, and v1 can evolve only the external task strategy: propose one candidate, compare it with the active strategy on a frozen matched benchmark, mechanically recompute scores, and promote it only when independent evidence exceeds a configured threshold. The reward stays external — tests, checks, metrics, evidence, and humans at gates.

## What this means for the roadmap

- Current (`v1.0.x`): complete canonical Skill, protocol v1, evidence-bound evaluator artifacts, digest-bound strategy approval/rejection and rollback, and a local Runner with leases, interval scheduling, durable events, authoritative accounting time, and opt-in command execution.
- Next: provider-native executors, human gate files, richer scheduling, and worker rebuild with state inheritance.
- Later: process-level checkpoint evidence in the verification contract, and dependency-aware item graphs if real loops demand them.

One sentence of positioning: **Loop-Engineering is not a bet that loops solve everything; it is a bet that whatever loops people run, the loop itself deserves a contract.**
