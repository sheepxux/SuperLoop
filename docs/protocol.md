# Protocol

`loop.yaml` is the portable contract for a recurring agent workflow.

The core sequence is:

```text
goal -> discovery -> handoff -> verification -> persistence -> schedule
```

## Required Sections

- `metadata`: name, owner, description, risk, tags.
- `goal`: objective, acceptance criteria, stop conditions, blocked conditions.
- `discovery`: bounded sources and ranking policy.
- `handoff`: worker role, isolation, worktree behavior, permissions, prompt.
- `verification`: independent evaluator, default stance, evidence, commands, verdicts.
- `persistence`: state path, run log directory, inbox, decisions.
- `schedule`: runtime, cadence, timezone, timeout, concurrency.
- `runner` (optional): local executor type (`dry-run` or `command`), working directory, command, and poll interval.
- `safety`: budgets, retries, human gates, failure policy.
- `evolution` (optional): task-strategy baseline, trigger, metric, independent benchmark evaluator, and promotion policy.
- `outputs`: expected artifacts from a run.

## Validator Guarantees

The protocol v1 validator rejects:

- Worker and evaluator with the same role.
- Write permissions without isolation.
- Scheduled loops with manual cadence.
- Discovery budgets above safety budgets.
- Executable evidence without verification commands.
- High-risk permissions without human-only gates.
- Strategy evolution without separate persistence paths or an independent strategy evaluator.
- Automatic strategy promotion for medium- or high-risk loops.
- Command executors without an explicit command.

JSON Schema catches shape errors. Custom validation catches loop-safety errors.

## Runtime Helpers

Two commands make the persistence contract mechanical instead of aspirational:

- `loopctl next <loop-dir>` reads `loop.yaml` and `state.json` and prints a JSON plan: `ok` (daily run budget, with UTC day rollover), `itemsAllowed`, `retryQueue` (failed items still under `maxRetriesPerItem`), `exhausted` (items that must go to the inbox), and `needsHuman`. Exit code 2 means "do not run".
- `loopctl record <loop-dir> --run <run-log.json>` validates the run log against `run-log.schema.json`, rejects logs whose results exceed `safety.budgets.maxItemsPerRun`, files the log under `runLogDir`, and rewrites `state.json` (lastRunAt, budget counters, item statuses, retry counts) after validating it against `state.schema.json`.
- `loopctl evolve <loop-dir> --experiment <experiment.json>` validates a candidate against `experiment.schema.json`, requires matched metric names, minimum samples, successful configured commands, the current baseline version, and the configured improvement threshold. It writes only `strategy.json`; it never edits `loop.yaml`. Human-review promotion requires a second call with `--approve`.

## Strategy Evolution

Evolution-enabled loops add two durable artifacts:

- `strategy.json`: the active, versioned task instructions. This is the only mutable behavior surface.
- `experiments/<id>.json`: matched baseline/candidate scores, sample counts, evidence, and an independent recommendation.

`state.json.evolution` records the active version, runs since promotion, consecutive failures, recent metric observations, pending review, and experiment history. `loopctl next` reports `evolution.due` when a configured trigger fires.

This is empirical strategy optimization, not model self-training. A candidate cannot change discovery bounds, permissions, verification, budgets, or human gates.

## Local Runner

`loopd start --once` scans `.loop-engineering/loops`, checks pause state, cadence and `loopctl next`, then acquires `locks/active-run.json` atomically. A successful tick produces a per-run directory containing the plan, event stream, final run log, command output and summary. The lease is released in a `finally` path and expired leases are recoverable.

The `dry-run` executor exercises scheduling and persistence without external calls. The `command` executor receives `LOOP_DIR`, `LOOP_SPEC`, `LOOP_RUN_DIR`, `LOOP_RUN_LOG`, `LOOP_PLAN`, `LOOP_RUN_ID`, and `LOOP_STRATEGY`. It must write a terminal run-log draft to `LOOP_RUN_LOG`; `loopd` validates and records it. Local commands are disabled unless the operator passes `--allow-command`.

Agents should never edit `state.json` by hand; every rendered skill routes persistence through these commands.

## Enforcement Boundary (protocol v1)

The validator, `next`, `record`, leases, cadence checks and command timeouts are mechanical. Agent-level permissions and human gates remain contract language interpreted by the executing agent; `loopd` is not an OS sandbox. The command executor therefore requires explicit operator opt-in.
