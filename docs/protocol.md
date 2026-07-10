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
- `safety`: budgets, retries, human gates, failure policy.
- `outputs`: expected artifacts from a run.

## Validator Guarantees

The protocol v1 validator rejects:

- Worker and evaluator with the same role.
- Write permissions without isolation.
- Scheduled loops with manual cadence.
- Discovery budgets above safety budgets.
- Executable evidence without verification commands.
- High-risk permissions without human-only gates.

JSON Schema catches shape errors. Custom validation catches loop-safety errors.

## Runtime Helpers

Two commands make the persistence contract mechanical instead of aspirational:

- `loopctl next <loop-dir>` reads `loop.yaml` and `state.json` and prints a JSON plan: `ok` (daily run budget, with UTC day rollover), `itemsAllowed`, `retryQueue` (failed items still under `maxRetriesPerItem`), `exhausted` (items that must go to the inbox), and `needsHuman`. Exit code 2 means "do not run".
- `loopctl record <loop-dir> --run <run-log.json>` validates the run log against `run-log.schema.json`, rejects logs whose results exceed `safety.budgets.maxItemsPerRun`, files the log under `runLogDir`, and rewrites `state.json` (lastRunAt, budget counters, item statuses, retry counts) after validating it against `state.schema.json`.

Agents should never edit `state.json` by hand; every rendered skill routes persistence through these commands.

## Enforcement Boundary (protocol v1)

The validator, `next`, and `record` are mechanical. Everything else — isolation, permissions, human gates — is contract language interpreted by the executing agent. Protocol v1 has no sandbox; a future Runner (`loopd`) is intended to add runtime enforcement.
