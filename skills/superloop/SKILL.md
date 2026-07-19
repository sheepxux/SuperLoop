---
name: superloop
description: Turn vague, recurring, or finite long-horizon ideas into verifiable Goal Contracts, approved fixed Work Plans, and safe LoopProposals, then design, scaffold, operate, review, recover, and empirically improve durable agent loops. Use when a user has an underspecified idea, wants AI to complete a composite task part by part, needs recurring judgment, independent verification, or persistent state, works with proposal.yaml or loop.yaml, or needs to diagnose or improve an existing loop. Route bounded one-shot and deterministic work to smaller alternatives instead of forcing a loop.
license: MIT
---

# SuperLoop

Compile an idea into a bounded, auditable agent loop. Treat a `LoopProposal` as a non-executable design, `loop.yaml` as the immutable operating contract, and `strategy.json` as the only evolvable behavior surface.

## Route the request first

Classify the work before creating an executable artifact:

- **One-shot**: complete the task in one bounded execution and evaluation context. Do not create a loop.
- **Deterministic**: prefer a script, CI job, cron entry, or existing automation.
- **Agentic loop**: continue when recurring work requires judgment or when a finite composite outcome needs durable, independently verified progress across multiple Parts.
- **Unsafe loop**: redesign with human gates or refuse unattended execution.

Treat vagueness as an intake problem, not proof that a loop is appropriate. Read [suitability and patterns](references/suitability-and-patterns.md) when the route or loop shape is unclear.

For **one-shot** and **deterministic** work, report the route and smaller mechanism, then stop this Skill workflow. For **agentic loop** or **unsafe loop** work, select exactly one primary mode. Default to **Propose** when the user supplies a vague idea or has not approved a proposal.

| Mode | Deliverable | Read |
| --- | --- | --- |
| Propose | non-executable Goal Contract and candidate loop | [idea to loop](references/idea-to-loop.md) |
| Assess | suitability verdict and missing prerequisites | [suitability and patterns](references/suitability-and-patterns.md) |
| Design | approved, digest-bound loop contract and safety policy | [contract design](references/contract-design.md), [safety and governance](references/safety-and-governance.md) |
| Scaffold | initialized loop directory and validated adapters | [runtime integrations](references/runtime-integrations.md) |
| Run | one bounded iteration with persisted evidence | [execution and evaluation](references/execution-and-evaluation.md) |
| Review | findings-first contract, state, evidence, and risk review | the reference matching the findings |
| Recover | diagnosis plus the smallest safe recovery action | [troubleshooting](references/troubleshooting.md) |
| Evolve | matched benchmark experiment and promotion decision | [strategy evolution](references/strategy-evolution.md) |

Do not silently expand from one mode into a materially riskier mode.

## Propose from a vague idea

1. Preserve the user's idea and state the suitability route.
2. Ask zero to three questions only when the answers change the goal, evidence, authority, bounds, or required integration. Continue with clearly labeled assumptions when doing so is safe.
3. Write a Goal Contract with one observable outcome, evidence-bearing acceptance criteria, non-goals, stop conditions, and blocked conditions.
4. Choose one execution shape. Use bounded discovery for a continuous stream; for a finite composite outcome, derive one fixed Work Plan from the approved Goal whose Parts have stable IDs, dependencies, expected artifacts, exact Part acceptance criteria, and—when Parts need different checks—Part-specific evidence/command envelopes. Read [work plans](references/work-plans.md) for finite work. Never select a domain preset or create another product Skill per Part; domain tools may run only inside the bounded worker/evaluator roles of this one Loop.
5. Recommend a candidate loop with a bounded unit of work, discovery or approved Parts, worker boundary, independent Part evaluator, final Goal evaluator when finite, persistence, cadence, item/time/cost/retry budgets, human gates, prerequisites, and an evolution boundary.
6. Record unanswered questions, assumptions, prerequisites, traceability, and readiness in a [`LoopProposal`](assets/proposal.yaml). The bundled starter is intentionally `needs-input`; never present it as an approvable finished proposal. Validate the actual proposal with `loopctl proposal validate <proposal.yaml>`.
7. Present the Goal Contract, execution shape, and candidate loop in plain language. For finite work, show Part order/dependencies, Part Gates, and the final Goal Gate. Stop for human confirmation while readiness is `needs-input` or `ready-for-review`.

A `needs-input` proposal must still be a concrete review packet, not a placeholder skeleton. When the known idea already names observable stages, instantiate stable Part IDs, exact dependency edges, durable expected artifacts, criterion statements/pass conditions, and effective verification envelopes from those known stages; keep unknown domain facts as explicit questions or assumptions. Never emit `part-…`, “TBD Part,” an omitted cost bound, or an unbounded source set. A continuous candidate must include provisional numeric caps for approved sources, items, runtime, cost, and retries; an empty approved-source allowlist is blocking. A finite review packet must explicitly state that material Part, dependency, artifact, criterion, or Goal-Gate changes require a parent-linked proposal revision, fresh digest approval, compilation, validation, and a supported migration before execution resumes; prior passes do not transfer automatically.

Never treat a proposal, evaluator verdict, or readiness status as authority to execute. A human must bind a decision to the exact proposal digest before compilation:

```bash
loopctl proposal decide proposal.yaml --approve --actor <human> --reason <text> --out decision.json
loopctl proposal compile proposal.yaml --decision decision.json --out loop.yaml
```

Invoke `--approve` only after the user has actually reviewed and explicitly approved that exact proposal. Before approval, require the human to confirm or reject every design assumption and verify the declared status of every prerequisite; blocking assumptions must be `confirmed`, blocking prerequisites must be `met`, and readiness/blockers must match those facts. The CLI records a local actor assertion; it cannot authenticate a human or manufacture consent. Use `--reject`, or `--request-changes --change <text>`, instead of `--approve` when appropriate. Compilation must fail if the decision is not an approval, the proposal digest changed, readiness is not `ready-for-review`, or required questions and prerequisites remain unresolved.

For revision 2 and later, preserve lineage and supply the exact parent at every gate:

```bash
loopctl proposal revise proposal-v1.yaml --out proposal-v2.yaml
loopctl proposal validate proposal-v2.yaml --parent proposal-v1.yaml
loopctl proposal decide proposal-v2.yaml --parent proposal-v1.yaml --approve --actor <human> --reason <text> --out decision-v2.json
loopctl proposal compile proposal-v2.yaml --parent proposal-v1.yaml --decision decision-v2.json --out loop.yaml
```

The backward-compatible direct `loop.yaml` path is allowed only when the user supplies an existing Loop contract or explicitly requests expert direct authoring. An agent must never move a vague or new idea onto that path unilaterally.

## Resolve the runtime

Prefer an installed `loopctl`. Inside the source repository, use `node ./bin/loopctl.js`. From this Skill package, [`node scripts/run-loopctl.mjs`](scripts/run-loopctl.mjs) locates either form and fails with installation guidance when neither exists.

When a loop contract exists, start every loop repository task with:

```bash
loopctl doctor
loopctl validate <loop.yaml>
```

Never claim that a command ran unless its output or exit code was observed.

## Design or revise a loop

1. Verify the approval decision and proposal digest. Use the expert direct-contract path only for a user-supplied existing contract or an explicit user request for direct authoring.
2. Preserve the approved objective, evidence, bounds, prerequisites, and authority without adding assumptions during compilation.
3. Bound continuous discovery with deterministic collection before model ranking. For a finite Work Plan, preserve the exact approved Parts, dependencies, artifacts, Part Gates, and Goal Gate; do not rediscover or rewrite the plan at runtime.
4. Isolate one worker per item and grant minimum permissions.
5. Assign technical judgment to an independent evaluator with concrete evidence; reserve external authority for a human gate.
6. Persist state, decisions, inbox items, run artifacts, budgets, and retries outside chat.
7. Choose the least powerful runtime that satisfies the cadence.
8. Validate the completed contract mechanically before execution.

Use [the starter contract](assets/loop.yaml) rather than inventing field names. Read [contract design](references/contract-design.md) for field-level decisions. The self-contained package also includes [proposal](assets/proposal.yaml), [proposal decision](assets/proposal-decision.json), [state](assets/state.json), [evaluator result](assets/evaluator-result.json), [final Goal evaluation](assets/goal-evaluation.json), [run log](assets/run-log.json), [strategy](assets/strategy.json), [experiment](assets/experiment.json), [strategy approval](assets/approval.json), and [strategy rejection decision](assets/decision.json) templates.

## Scaffold

Initialize a named loop and render only the needed platform adapter:

```bash
loopctl init <name> --from <loop.yaml> --out .superloop/loops
loopctl render codex .superloop/loops/<name>/loop.yaml --out .
loopctl render claude-code .superloop/loops/<name>/loop.yaml --out .
```

For a proposal-compiled contract, `<name>` must exactly equal `loop.yaml.metadata.name` and `--out` must remain `.superloop/loops`. Initialization must preserve the reviewed paths `.superloop/loops/<name>/{state.json,runs/,inbox.md,decisions.md}`; revise and re-approve instead of renaming or relocating them. The compiled `loop.yaml` retains the complete `goalContract`, plus provenance digests for the proposal, candidate Loop body, Goal Contract, and reconstructable human approval. Validate it against the retained review artifacts before initialization so digest-inconsistent tampering fails closed.

Inspect generated files before enabling a schedule or command executor. Treat GitHub Actions output as a scaffold until it contains a real executor and durable state channel.

## Run one bounded iteration

1. Run `loopctl next <loop-dir>` and obey `ok`, `phase`, `itemsAllowed`, `eligibleParts`, retry, budget, and human-gate output.
2. In continuous work, discover no more than the allowed number of stable item IDs. In finite `work` phase, select only IDs returned in `eligibleParts`; never work a locked or out-of-plan Part.
3. Give one item or Part at a time to an isolated worker. Permit development checks, but never let the worker issue the final verdict.
4. Give the artifact, worker notes, exact frozen active Part definition and digest, and its effective verification commands—not hidden reasoning—to a fresh evaluator context. When the Part declares `verification`, use that evidence/command envelope; otherwise use the Loop-level verification envelope. A Part passes only when its exact Part acceptance criteria, effective evidence/commands, and expected artifacts pass the Part Gate. Every accepted artifact reference must resolve to a distinct, run-specific regular-file snapshot inside the Loop directory whose bytes match its declared SHA-256; never overwrite an accepted snapshot, and use a new snapshot on correction. Keep editable working files separate, and use a durable local export or receipt for externally hosted outputs. A failed Part Gate retries that same Part within budget and never unlocks its dependents.
5. In `goal-evaluation` phase, do not discover or modify Parts. Use the configured independent completion evaluator to judge the integrated result against every exact Goal acceptance criterion, with evidence types and commands at least as strong as the approved verification envelope. Only a passing Goal Gate completes the Loop. When refusing a request to skip or reorder a failed Part, explicitly restate that the Loop remains incomplete until every Part Gate and this final Goal Gate pass.
6. Require schema-valid evaluator evidence for every attempted item; use the [run-log template](assets/run-log.json) for the aggregate artifact.
7. Record the terminal run through `loopctl record`; never edit `state.json` manually.
8. Stop at `completed`, a budget, blocked condition, human-only action, or configured stopping condition. Clearing a scheduler pause does not resolve a blocked Part or final Goal Gate. After the required human/prerequisite decision, use `loopctl part reopen <loop-dir> --id <part> --actor <human> --reason <text>` or `loopctl goal resolve <loop-dir> --actor <human> --reason <text>` so the transition binds the exact blocking run.

Read [execution and evaluation](references/execution-and-evaluation.md) before changing code, UI, data, or external state.

## Evolve without weakening control

Evolve only task strategy instructions. Never let a candidate change discovery bounds, permissions, budgets, verification, evidence requirements, human gates, or the loop contract.

Require the same benchmark cases for baseline and candidate, exact arm/strategy-digest attribution, mechanically recomputed scores, independent evidence, a configured minimum improvement, a retained rollback point, and human approval unless the loop is explicitly low-risk. A reviewer must approve or immutably reject a pending candidate; never leave it stuck. Read [strategy evolution](references/strategy-evolution.md) and start from the [experiment template](assets/experiment.json) before creating or reviewing an experiment.

## Required evidence

End every mode with concrete artifacts, not an assurance. Report:

- suitability route and selected mode;
- assumptions, unresolved questions, prerequisites, and readiness when proposing;
- files created or changed;
- commands and observed results;
- items attempted and evaluator verdicts when a run occurred;
- active phase, eligible/locked Parts, Part Gate results, and final Goal Gate result for finite work;
- budget consumed and remaining;
- inbox, blocked, or human-review items;
- active strategy version and experiment outcome when evolution ran;
- the next bounded action.

If independent evaluation, required tools, credentials, or durable persistence are unavailable, say so and stop or downgrade honestly.

## Hard invariants

- Never compile or execute an unapproved or digest-mismatched proposal.
- Never approve a starter or revision whose assumptions, prerequisites, blockers, and readiness have not been reconciled with human review.
- Never rename or relocate a provenance-bound contract during initialization.
- Never let a worker approve its own output.
- Never confuse evaluator evidence with human authority.
- Never treat dry-run or no-work as verified task success.
- Never call each Part a new Loop: one Loop owns the whole Goal, a Part is one bounded unit, and an Iteration is one attempt.
- Never encode a writing, software, research, or other domain workflow into the product Skill. Derive Parts, evidence, and tools from the reviewed Goal while keeping the same universal control protocol.
- Never work a locked or out-of-plan Part, advance after a failed Part Gate, or declare completion before the final Goal Gate passes.
- Never redirect a failed Part attempt to another definition: retry the same frozen Part and bind its evaluator to that exact definition digest.
- Never append, remove, reorder, or reinterpret approved Parts during execution; stop and create a new proposal revision when scope changes.
- Never present a vague placeholder Work Plan or an unbounded continuous candidate as reviewable. Use concrete safe assumptions with explicit blockers, numeric bounds, and exact Part definitions.
- Never merge, deploy, delete data, spend money, message external users, or change permissions without an explicit human-only decision.
- Never interpret `--allow-command` as broader authority than the user granted.
- Never accept self-reported metrics as proof when raw cases and evidence can be checked.
- Never run untrusted repository commands with privileged credentials.
- Never continue merely because another iteration is possible; continue only while the objective, budget, and evidence justify it.
