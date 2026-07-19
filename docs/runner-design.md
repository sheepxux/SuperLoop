# Local Runner (`loopd`)

`loopd` is the local reference runtime for validated SuperLoop contracts.

## Execution flow

```text
scan → pause/cadence check → loopctl next → acquire lease
     → create run directory → execute → validate terminal log
     → verify evidence/budgets → record → release lease
```

For continuous loops, `next` returns bounded discovery and retry information. For a finite Work Plan it also returns `phase`:

- `work`: the command may attempt only returned `eligibleParts`; locked dependencies are unavailable and each result binds the exact Part-definition digest and declared artifacts;
- `goal-evaluation`: all Parts passed, so the command performs no discovery or Part work and instead records the independent final Goal artifact bound to `goalEvaluationBasisSha256`;
- `completed`: the Goal Gate passed and no command is started.

## Modes

- `dry-run`: exercises planning, leases, events, and artifacts. It records a `dry-run` run but does not update task success, budgets, cadence state, or evolution metrics.
- `command`: invokes a configured local command only when the operator passes `--allow-command`. The command receives loop/run environment variables and must write a terminal run-log draft. The Runner overwrites draft start/finish timestamps with its wall clock and freezes the active strategy binding, so a command cannot backdate work or claim another strategy. It also freezes `state.json` and `loop.yaml`; if the command changes either file, the Runner retains tamper evidence, restores the exact preflight snapshot, rejects the draft, and records a counted failure. It cannot report `dry-run`; a missing or invalid draft becomes a counted terminal failure with the original draft retained for diagnosis. Reported or measured over-budget work becomes an accounting-only `budget-exceeded` failure: usage is charged, while discovered items/results cannot mutate state.

## Durable artifacts

Each run directory may contain `plan.json`, `events.ndjson`, `stdout.log`, `stderr.log`, `run-log.draft.json`, validated `run-log.json`, run-specific Part artifact snapshots, Part evaluator artifacts, a final Goal-evaluation artifact, and `summary.md`. Finite Part state retains accepted artifact IDs, references, SHA-256 digests, and the exact run/evaluator binding. Accepted snapshots must exist inside the Loop directory, match their recomputed digest, and remain immutable; corrections create new snapshot references from separate working files. Lifecycle state retains the last Goal Gate bound to its immutable run and `completedAt` only after a pass. Audited Part and Goal resolution ledgers preserve blocked/human recovery evidence.

## Concurrency and recovery

The active lease carries a random owner token, loop generation and contract digest, process/host identity, start/heartbeat/expiry timestamps, and a timeout grace period. Acquire, recovery, renewal, and release are serialized through bounded operation claims; malformed leases fail closed, and only the current owner can renew or release. The Runner renews and rebinds the lease before committing a terminal record; a reinitialized generation or changed contract invalidates stale work. State mutations use a separate serialized lock. Every lock publication and stale recovery crosses the same short-lived atomic acquisition gate, preventing a delayed reclaimer from deleting a newer owner. That gate is never automatically reclaimed: a crash inside the doorway fails closed until an operator verifies that no loop process is alive and clears it manually. An allowlisted transaction journal recovers partially committed run/state and evolution writes. v1.x may add async heartbeats during command execution.

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

The command executor runs with the current user's OS permissions. `--allow-command` authorizes the configured local command transport only; it does not override SuperLoop human gates or the user's stated scope. For a finite plan, the serialized `LOOP_PLAN` is authoritative for phase, eligible/locked Parts, exact Part digests, and the Goal basis digest; the command may not rediscover or mutate Parts. Commands must remain in the foreground and must not daemonize or leave background children; the reference Runner is not a process-group or container sandbox.

## External schedulers

GitHub Actions, Codex automation, and cloud schedulers remain external. The bundled GitHub Actions renderer emits only a manual, read-only preflight scaffold. Add a trusted executor, durable state channel, least-privilege permissions, and secret policy before scheduling it.
