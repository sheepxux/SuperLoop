# Execution and Independent Evaluation

## Preflight

Run `loopctl validate` and `loopctl next`. Stop when `ok=false`; do not bypass a budget or pause by manually recording a run. For a finite Work Plan, obey `phase`, `eligibleParts`, `lockedParts`, and each eligible Part's exact definition digest.

## Worker boundary

Give the worker one continuous item or one eligible Work Plan Part, the active task strategy, the allowed files/actions, and the expected artifact. For a Part, also give its exact definition digest, acceptance criteria, dependencies, and expected artifact IDs. Obey the declared isolation mode: repository work may use a worktree or branch, general file deliverables may use a task directory, and thread isolation must still persist outputs outside chat.

The worker may run narrow development checks for feedback. It must not issue the final evaluator verdict, approve its strategy, merge, deploy, or broaden its own permissions.

Before removing any temporary isolation boundary, preserve its deliverable and evidence in approved durable paths. For a worktree this may be a patch or commit; never delete the only copy of unreviewed work.

## Evaluator boundary

Use a fresh context or process. Hand over only inspectable material:

- stable item ID and acceptance criteria;
- diff or output artifact;
- worker notes;
- required verification commands;
- relevant environment facts.

Do not pass private chain-of-thought as evidence. Record evaluator identity/run ID when the harness exposes it.

For every attempted item, require a schema-valid evaluator result containing the verdict, summary, executed checks, exit codes, and artifact references or digests. Recompute aggregate run status from item verdicts.

For Work Plan phase `work`, evaluate only the active Part's exact acceptance criteria plus global non-goals, blocked conditions, permissions, and safety policy. Use that Part's `verification` evidence/commands when present; otherwise inherit the Loop-level verification envelope. This lets heterogeneous Parts use their own proof without forcing unrelated checks on every Part. A passing Part result must bind the exact Part definition digest, pass every Part criterion and effective check, and return every declared artifact ID, reference, and digest. Every reference must be a distinct, run-specific regular-file snapshot inside the Loop directory whose bytes match the declared SHA-256. Accepted snapshots are immutable audit evidence; correction writes a new snapshot while editable working files remain separate. Externally hosted outputs need a durable local export or receipt. Do not require an intermediate Part to satisfy the whole Goal Contract.

A failed Part Gate stays on that exact frozen Part definition and consumes only its declared retry budget; it cannot be redirected to an easier Part or used to unlock dependents. A blocked or human-required Part can be reopened only through the audited `loopctl part reopen` transition after the prerequisite or decision is genuinely resolved. Merely running `loopctl resume` does not alter Part state.

For phase `goal-evaluation`, do not run a worker or report Part results. Use the configured completion evaluator in a fresh context, bind the artifact to the runtime-provided Goal basis digest, and evaluate every exact whole-Goal acceptance criterion. Its required evidence and commands must cover the full approved verification envelope. A pass completes the Loop. A fail identifies affected roots that trace to the failed Goal criteria; `blocked` or `needs-human` stops until an audited `loopctl goal resolve` binds the resolved prerequisite or decision to that exact run. Read [fixed work plans](work-plans.md).

## Terminal statuses

- `passed`: every attempted item passed independent evaluation.
- `failed`: one or more items failed verification.
- `blocked`: required access, dependency, or evidence is unavailable.
- `needs-human`: continuation requires a human-only decision.
- `no-work`: discovery found no eligible items; do not count it as task success.
- `dry-run`: planning/runtime exercise only; do not feed it into strategy metrics.
- `completed`: finite Work Plan only; the final Goal Gate passed and no further run is allowed.

## Persistence

Write run artifacts before updating the active state, use atomic replacement where available, and retain failure artifacts. Use `loopctl record` or Runner-managed persistence; never hand-edit counters.

When evolution is enabled, bind the run log to the exact active `strategy.json` version and SHA-256 from preflight. If that anchor changes before recording, discard the stale result and start a new run; never attribute old-strategy evidence to a promoted strategy.

## Completion report

List phase, attempted items or Parts, verdicts, exact checks, evidence paths, eligible and locked Parts, Goal Gate outcome, budget usage, state changes, attention items, and the next bounded action.
