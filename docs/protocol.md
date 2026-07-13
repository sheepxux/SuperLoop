# Protocol v1

`loop.yaml` is the immutable contract for a recurring agent workflow:

```text
goal → discovery → handoff → verification → persistence → schedule → safety
```

Task strategy lives separately in `strategy.json`. A strategy candidate cannot modify the contract.

## Required sections

- `metadata`: stable name, owner, description, risk, tags.
- `goal`: objective, acceptance, stop, and blocked conditions.
- `discovery`: bounded sources, deterministic-first ranking, item cap.
- `handoff`: worker role, isolation, typed permissions, prompt.
- `verification`: independent evaluator, evidence types, commands, verdicts.
- `persistence`: repository-relative paths under the loop directory.
- `schedule`: runtime, cadence, timezone, timeout, concurrency.
- `runner` (optional): dry-run or command executor.
- `safety`: budgets, retries, typed action gates, failure policy.
- `evolution` (optional): external task-strategy experiment policy.
- `outputs`: expected durable artifacts.

## Mechanical safety checks

The validator rejects self-evaluation, writes without isolation, discovery above the item budget, timeouts above the runtime budget, unsafe paths or branch prefixes, high-risk permissions without exact human-only action IDs, duplicate gate IDs, missing executable verification, and automatic promotion for non-low-risk loops.

Human gate entries are typed IDs such as `open-pull-request`, `merge-pull-request`, `deploy-production`, and `change-permissions`; substring matches are not accepted.

## Run evidence

`loopctl record` accepts terminal logs only. Each attempted item binds:

- a schema-valid evaluator artifact stored inside the loop directory;
- evaluator identity and independent context ID;
- loop, item, and verdict equality;
- the artifact SHA-256;
- every configured evidence type and successful command for a passing result.

The recorder rejects duplicate/unknown item IDs, terminal-state overwrites, retry-exhausted work, `passed` with no results, aggregate status/verdict mismatches, duplicate command evidence, malformed/future/regressing timestamps, discovery/cost/time/item overruns, missing or foreign state, evaluator identity mismatch, real-path escape, and daily budget bypasses. A dedicated accounting date cannot move backward and recovery derives it from immutable completion evidence. A bounded state ledger binds run IDs and exact artifact paths to immutable digests, so identical replay is idempotent but revalidates evaluator evidence; pre-created or missing artifacts fail closed. Only the trusted dry-run Runner may record `dry-run`. For command execution, the Runner supplies the authoritative start/finish clock and active strategy binding. Observed overruns are durably charged as accounting-only `budget-exceeded` records with no discovered items or task results.

State and leases bind a loop-generation identifier and the exact `loop.yaml` SHA-256. Evolution-enabled attempted runs also bind the exact active strategy version and SHA-256. Evidence produced before a promotion cannot be recorded against the new strategy or counted toward its observations and triggers.

## Strategy experiments

A new experiment may be staged only after the configured `afterRuns` or `consecutiveFailures` trigger is due, and a loop may hold only one pending experiment. The trigger uses counters since the last experiment attempt, while since-promotion counters remain separate audit data. An experiment includes a benchmark manifest and digest, stable case IDs, matched baseline/candidate case results, exact baseline/candidate strategy SHA-256 values, per-case arm/strategy bindings, artifacts and digests, configured evaluator identity/context/command evidence, a digest-bound experiment attestation, and a promotion recommendation. Scores are recomputed from per-case results, artifact contents must match their recorded case fields, and any failed candidate case disqualifies promotion regardless of aggregate score or approval.

For human-reviewed promotion:

1. `loopctl evolve` stages the exact experiment digest.
2. `loopctl approval create` produces an approval bound to that digest.
3. `loopctl evolve --approval` verifies state, staged file, digest, baseline, approver, and timestamp.

If the reviewer rejects it, `loopctl experiment reject` writes an immutable digest-bound decision with actor, time, and reason, marks history `abandoned`, clears pending, and consumes the trigger. A new experiment requires fresh attributable runs. A pending experiment must be approved or rejected before rollback.

Promotion archives both strategies and the exact approval artifact. Staging time must follow all case/top-level evaluation evidence, and approval time must follow both evidence and staging. `loopctl strategy rollback` restores archived behavior as a new version and records actor, reason, and time. Run/state and experiment/approval/decision/strategy changes use an allowlisted recovery journal so a process interruption cannot leave an accepted artifact without its matching accounting state.

The runtime rejects an approver string equal to any configured worker or evaluator identity. The string itself is still a local audit assertion, not authenticated identity or a digital signature; deployments that need enforceable governance must add their own identity-backed approval channel.

## v1.0.1 migration

Before a v1.0.2 runtime operates an existing loop, stop its Runner and run `loopctl migrate <loop-dir>`. Migration adds generation/contract bindings and anchors an exact continuous `v1..active` strategy chain; orphan/future archives, broken parents, active owners, or contract/version/digest inconsistencies fail closed. A repeat migration on a current consistent loop is a no-op. A legacy pending experiment is marked `invalidated`; rebuild it under a new experiment ID with v1.0.2 per-case attestations and never reuse its old approval. Remote or unverifiable expired leases require operator verification plus `--retire-expired-lease`; a live same-host PID is never retired.

## Enforcement boundary

Schema checks, typed gates, budgets, hashes, state transitions, leases, and timeouts are mechanical. Natural-language intent and local command permissions are not an OS sandbox. Keep privileged credentials away from unattended loops and preserve human-only governance for external effects.
