# Local Runner (`loopd`)

`loopd` is the local reference runtime for validated Loop-Engineering contracts.

## Execution flow

```text
scan → pause/cadence check → loopctl next → acquire lease
     → create run directory → execute → validate terminal log
     → verify evidence/budgets → record → release lease
```

## Modes

- `dry-run`: exercises planning, leases, events, and artifacts. It records a `dry-run` run but does not update task success, budgets, cadence state, or evolution metrics.
- `command`: invokes a configured local command only when the operator passes `--allow-command`. The command receives loop/run environment variables and must write a terminal run-log draft. The Runner overwrites draft start/finish timestamps with its wall clock and freezes the active strategy binding, so a command cannot backdate work or claim another strategy. It cannot report `dry-run`; a missing or invalid draft becomes a counted terminal failure with the original draft retained for diagnosis. Reported or measured over-budget work becomes an accounting-only `budget-exceeded` failure: usage is charged, while discovered items/results cannot mutate state.

## Durable artifacts

Each run directory may contain `plan.json`, `events.ndjson`, `stdout.log`, `stderr.log`, `run-log.draft.json`, validated `run-log.json`, evaluator artifacts, and `summary.md`.

## Concurrency and recovery

The active lease carries a random owner token, loop generation and contract digest, process/host identity, start/heartbeat/expiry timestamps, and a timeout grace period. Acquire, recovery, renewal, and release are serialized through bounded operation claims; malformed leases fail closed, and only the current owner can renew or release. The Runner renews and rebinds the lease before committing a terminal record; a reinitialized generation or changed contract invalidates stale work. State mutations use a separate serialized lock with race-safe stale recovery. An allowlisted transaction journal recovers partially committed run/state and evolution writes. v1.x may add async heartbeats during command execution.

## Command environment

- `LOOP_DIR`
- `LOOP_SPEC`
- `LOOP_RUN_DIR`
- `LOOP_RUN_LOG`
- `LOOP_PLAN`
- `LOOP_RUN_ID`
- `LOOP_STARTED_AT`
- `LOOP_STRATEGY`
- `LOOP_STRATEGY_VERSION`
- `LOOP_STRATEGY_SHA256`

The command executor runs with the current user's OS permissions. `--allow-command` authorizes the configured local command transport only; it does not override Loop-Engineering human gates or the user's stated scope. Commands must remain in the foreground and must not daemonize or leave background children; the reference Runner is not a process-group or container sandbox.

## External schedulers

GitHub Actions, Codex automation, and cloud schedulers remain external. The bundled GitHub Actions renderer emits only a manual, read-only preflight scaffold. Add a trusted executor, durable state channel, least-privilege permissions, and secret policy before scheduling it.
