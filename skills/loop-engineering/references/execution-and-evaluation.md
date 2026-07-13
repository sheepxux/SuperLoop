# Execution and Independent Evaluation

## Preflight

Run `loopctl validate` and `loopctl next`. Stop when `ok=false`; do not bypass a budget or pause by manually recording a run.

## Worker boundary

Give the worker one item, the active task strategy, the allowed files/actions, and the expected artifact. Isolate code changes in a worktree or equivalent boundary.

The worker may run narrow development checks for feedback. It must not issue the final evaluator verdict, approve its strategy, merge, deploy, or broaden its own permissions.

Preserve the patch or commit before removing a worktree. Never delete the only copy of unreviewed work.

## Evaluator boundary

Use a fresh context or process. Hand over only inspectable material:

- stable item ID and acceptance criteria;
- diff or output artifact;
- worker notes;
- required verification commands;
- relevant environment facts.

Do not pass private chain-of-thought as evidence. Record evaluator identity/run ID when the harness exposes it.

For every attempted item, require a schema-valid evaluator result containing the verdict, summary, executed checks, exit codes, and artifact references or digests. Recompute aggregate run status from item verdicts.

## Terminal statuses

- `passed`: every attempted item passed independent evaluation.
- `failed`: one or more items failed verification.
- `blocked`: required access, dependency, or evidence is unavailable.
- `needs-human`: continuation requires a human-only decision.
- `no-work`: discovery found no eligible items; do not count it as task success.
- `dry-run`: planning/runtime exercise only; do not feed it into strategy metrics.

## Persistence

Write run artifacts before updating the active state, use atomic replacement where available, and retain failure artifacts. Use `loopctl record` or Runner-managed persistence; never hand-edit counters.

When evolution is enabled, bind the run log to the exact active `strategy.json` version and SHA-256 from preflight. If that anchor changes before recording, discard the stale result and start a new run; never attribute old-strategy evidence to a promoted strategy.

## Completion report

List attempted items, verdicts, exact checks, evidence paths, budget usage, state changes, attention items, and the next bounded action.
