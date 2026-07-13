---
name: loop-engineering
description: Design, scaffold, operate, review, recover, and empirically improve durable agent loops. Use when a user asks to automate recurring or unattended work, convert a repeated agent task into a governed workflow, work with loop.yaml or loopd, add independent verification and persistent state, diagnose a stalled loop, or improve task strategy through measured experiments. Do not use for one-shot work that direct action or a deterministic script can complete.
license: MIT
---

# Loop-Engineering

Turn recurring agent work into a bounded, auditable system. Treat `loop.yaml` as the immutable operating contract and `strategy.json` as the only evolvable behavior surface.

## Route the request first

Classify the request before creating artifacts:

- **One-shot**: complete the task directly. Do not create a loop.
- **Deterministic**: prefer a script, CI job, cron entry, or existing automation.
- **Agentic loop**: continue when recurring work requires judgment, changing context, or bounded remediation.
- **Unsafe loop**: redesign with human gates or refuse unattended execution.

Read [suitability and patterns](references/suitability-and-patterns.md) when the classification or loop shape is unclear.

For **one-shot** and **deterministic** requests, report that routing decision and stop this Skill workflow; do not create loop artifacts or invoke `loopctl`. Only **agentic loop** and **unsafe loop** requests continue below. Then select exactly one primary mode:

| Mode | Deliverable | Read |
| --- | --- | --- |
| Assess | suitability verdict and missing prerequisites | [suitability and patterns](references/suitability-and-patterns.md) |
| Design | reviewed loop contract and safety policy | [contract design](references/contract-design.md), [safety and governance](references/safety-and-governance.md) |
| Scaffold | initialized loop directory and validated adapters | [runtime integrations](references/runtime-integrations.md) |
| Run | one bounded iteration with persisted evidence | [execution and evaluation](references/execution-and-evaluation.md) |
| Review | findings-first contract, state, evidence, and risk review | the reference matching the findings |
| Recover | diagnosis plus the smallest safe recovery action | [troubleshooting](references/troubleshooting.md) |
| Evolve | matched benchmark experiment and promotion decision | [strategy evolution](references/strategy-evolution.md) |

Do not silently expand from one mode into another materially riskier mode.

## Resolve the runtime

Prefer an installed `loopctl`. Inside the source repository, use `node ./bin/loopctl.js`. From this Skill package, [`node scripts/run-loopctl.mjs`](scripts/run-loopctl.mjs) locates either form and fails with installation guidance when neither exists.

When a loop contract exists, start every loop repository task with:

```bash
loopctl doctor
loopctl validate <loop.yaml>
```

Never claim that a command ran unless its output or exit code was observed.

## Design or revise a loop

1. State the recurring objective, acceptance criteria, stop conditions, and blocked conditions.
2. Bound discovery with deterministic collection before model ranking.
3. Isolate one worker per item and declare the minimum permissions.
4. Assign final judgment to an independent evaluator with concrete evidence.
5. Persist state, decisions, inbox items, run artifacts, budgets, and retries outside chat.
6. Choose the least powerful runtime that satisfies the cadence.
7. Classify every external action as auto-allowed, needs-review, or human-only.
8. Validate the completed contract mechanically before execution.

Use [the starter contract](assets/loop.yaml) rather than inventing field names. Read [contract design](references/contract-design.md) for field-level decisions. The self-contained package also includes [state](assets/state.json), [evaluator result](assets/evaluator-result.json), [run log](assets/run-log.json), [strategy](assets/strategy.json), [experiment](assets/experiment.json), [approval](assets/approval.json), and [rejection decision](assets/decision.json) templates.

## Scaffold

Initialize a named loop and render only the needed platform adapter:

```bash
loopctl init <name> --from <loop.yaml> --out .loop-engineering/loops
loopctl render codex .loop-engineering/loops/<name>/loop.yaml --out .
loopctl render claude-code .loop-engineering/loops/<name>/loop.yaml --out .
```

Inspect generated files before enabling a schedule or command executor. Treat GitHub Actions output as a scaffold until it contains a real executor and durable state channel.

## Run one bounded iteration

1. Run `loopctl next <loop-dir>` and obey `ok`, `itemsAllowed`, retry, budget, and human-gate output.
2. Discover no more than the allowed number of stable item IDs.
3. Give one item to an isolated worker. Permit development checks, but never let the worker issue the final verdict.
4. Give the diff, worker notes, and verification commands—not hidden reasoning—to a fresh evaluator context.
5. Require schema-valid evaluator evidence for every attempted item; use the [run-log template](assets/run-log.json) for the aggregate artifact.
6. Record the terminal run through `loopctl record`; never edit `state.json` manually.
7. Stop at a budget, blocked condition, human-only action, or configured stopping condition.

Read [execution and evaluation](references/execution-and-evaluation.md) before changing code, UI, data, or external state.

## Evolve without weakening control

Evolve only task strategy instructions. Never let a candidate change discovery bounds, permissions, budgets, verification, evidence requirements, human gates, or the loop contract.

Require the same benchmark cases for baseline and candidate, exact arm/strategy-digest attribution, mechanically recomputed scores, independent evidence, a configured minimum improvement, a retained rollback point, and human approval unless the loop is explicitly low-risk. A reviewer must approve or immutably reject a pending candidate; never leave it stuck. Read [strategy evolution](references/strategy-evolution.md) and start from the [experiment template](assets/experiment.json) before creating or reviewing an experiment.

## Required evidence

End every run with concrete artifacts, not an assurance. Report:

- suitability and selected mode;
- files created or changed;
- commands and observed results;
- items attempted and evaluator verdicts;
- budget consumed and remaining;
- inbox, blocked, or human-review items;
- active strategy version and experiment outcome when evolution ran;
- the next bounded action.

If independent evaluation, required tools, credentials, or durable persistence are unavailable, say so and stop or downgrade honestly.

## Hard invariants

- Never let a worker approve its own output.
- Never treat dry-run or no-work as verified task success.
- Never merge, deploy, delete data, spend money, message external users, or change permissions without an explicit human-only decision.
- Never interpret `--allow-command` as broader authority than the user granted.
- Never accept self-reported metrics as proof when raw cases and evidence can be checked.
- Never run untrusted repository commands with privileged credentials.
- Never continue a loop merely because another iteration is possible; continue only while the objective, budget, and evidence justify it.
