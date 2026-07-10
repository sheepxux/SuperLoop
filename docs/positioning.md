# Positioning: Loop-Engineering

In mid-2026 the practice of running coding agents shifted from prompting to loop design. Peter Steinberger (OpenAI, author of OpenClaw), Boris Cherny (Claude Code lead), and Addy Osmani (Google) converged on the same advice within a week: stop hand-prompting agents; design the loops that prompt them. Osmani named the practice **Loop Engineering** and stacked the layers as:

```text
prompt -> context -> harness -> loop
```

The loop sits on top and makes everything underneath run again and again without a human in the chair. Earlier practice existed (Geoffrey Huntley's "Ralph Wiggum" pattern of pinning a mediocre agent to one task until it breaks through), but the enabling pieces — scheduling, worktrees, skills, subagents, external memory — only recently became product features rather than personal scripts.

Loop-Engineering's bet: once loops become how recurring agent work gets done, the loop itself needs a **portable, reviewable, mechanically checkable contract**. That contract should not belong to any one vendor. Loop-Engineering is that contract plus the tooling that makes it enforceable.

## The five loop actions map 1:1 onto the protocol

The commonly cited decomposition of a loop is five actions. `loop.yaml` encodes each one as a required section:

| Loop action | `loop.yaml` section | What the validator forces |
| --- | --- | --- |
| Discover | `discovery` | Bounded sources, deterministic-first ranking, `maxItemsPerRun` |
| Hand off | `handoff` | Isolation (worktree) whenever write permissions exist |
| Verify | `verification` | Independent evaluator, assume-broken stance, executable evidence needs commands |
| Persist | `persistence` | State, run logs, inbox, decisions — all outside chat |
| Schedule | `schedule` + `safety` | Cadence, timeout, budgets, retry caps, human gates |

The six building blocks practitioners assemble by hand also have Loop-Engineering counterparts: scheduled automation (rendered GitHub Actions workflow), worktrees (`handoff.worktree`), skills (rendered executor playbooks), connectors (left to the agent's own MCP tooling), worker/evaluator subagents (rendered prompts), and external memory (`state.json`, `inbox.md`, `decisions.md`).

## What Loop-Engineering hardens that prose loops leave soft

Osmani names the recurring costs of loop engineering. Loop-Engineering's position on each:

- **Intent debt** (every run cold-starts and guesses the house rules): the rendered executor skill is written once and read every run; the spec carries objective, acceptance criteria, and stop conditions so the agent does not re-derive them.
- **Verification debt** (unattended loops fail unattended): the validator rejects specs without an independent evaluator; the evaluator result is schema-checked (`loopctl check evaluator`); "done" still requires a human at the `needsReview`/`humanOnly` gates.
- **Token cost control**: `safety.budgets` is not advice — `loopctl next` refuses the run when the daily budget is spent, and `loopctl record` keeps the counters.
- **Orchestration tax** (parallelism is capped by human review bandwidth, not by tooling): `maxItemsPerRun`, `maxDailyRuns`, and the inbox are deliberate throttles. Keeping loops small is a feature.
- **Comprehension debt and cognitive surrender** (code nobody read, judgment quietly handed over): no protocol can absorb these. Loop-Engineering's contribution is to keep every run auditable without chat history — run logs, evidence, and decisions live in files a human can read later.

The pattern scales: Stripe's Minions pipeline merges over a thousand PRs a week with no hand-typed prompts, precisely because deterministic gates and LLM steps are composed into a designed pipeline with humans only at the end. Loop-Engineering is the same shape, specified once and portable across agents.

## Honest boundaries

Practitioner criticism of the loop hype is specific, and Loop-Engineering should agree with it rather than argue.

**Loops are overrated where topology is underrated.** Feedback-dense, single-goal tasks — CI triage, dependency updates, QA passes — are well served by a simple loop, and that is exactly the 80% use case the current v0.3.x release targets. Genuinely hard work is a graph of deeply coupled subtasks where agents get lost three levels deep. The v1 protocol deliberately models a single-lane loop: discover N bounded items, process them one at a time. It does not model dependency graphs between items, and it should not pretend to. If that expressiveness ever comes, it is a protocol extension (item dependencies, convergence checks), not a rendering trick.

**Long-running is not the same as hard.** Loop-Engineering optimizes for many small, bounded, resumable iterations — the nine-minute run that lands evidence and updates state — not for thirty-hour demo curves. The budgets exist to force that shape.

**Feedback is the loop's lifeline; signal density beats communication density.** A loop that runs for days with only end-of-run verdicts is managing an employee by silence. Today Loop-Engineering's evaluator verdict is outcome-level, per item. Process-level signals (mid-run checkpoints an evaluator can reject early) are a possible later protocol extension, noted in the roadmap.

**Multi-agent systems stay healthy by replacing context, not accumulating it.** Agents are Markovian; early errors compound, and self-review amplifies them. Loop-Engineering's architecture already assumes this: state lives outside the model, every run starts a fresh worker from `state.json`, and the evaluator never shares the worker's context. The local Runner preserves the same substrate; provider-native worker rebuilding remains a later extension.

**Model self-improvement is unproven; measurable strategy evolution is narrower.** Loop-Engineering does not claim loops make models better. It makes work *accumulate*, and v0.3 can evolve only the external task strategy: propose one candidate, compare it with the active strategy on matched samples, and promote it only when an independent evaluator supplies evidence above a configured threshold. The reward stays external — tests, checks, metrics, evidence, and humans at gates.

## What this means for the roadmap

- Current (`v0.3.x`): protocol v1, validator, executor skills, benchmark-gated task-strategy evolution, and a local Runner with leases, interval scheduling, durable events, and opt-in command execution.
- Next: provider-native executors, human gate files, richer scheduling, and worker rebuild with state inheritance.
- Later: process-level checkpoint evidence in the verification contract, and dependency-aware item graphs if real loops demand them.

One sentence of positioning: **Loop-Engineering is not a bet that loops solve everything; it is a bet that whatever loops people run, the loop itself deserves a contract.**
