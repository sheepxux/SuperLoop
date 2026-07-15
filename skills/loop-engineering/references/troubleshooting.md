# Troubleshooting and Recovery

## Diagnose before changing state

Run:

```bash
loopctl doctor
loopctl status --root .loop-engineering/loops --json
loopctl runs <loop-dir> --json
loopctl validate <loop-dir>/loop.yaml
loopctl next <loop-dir>
```

Inspect the latest run directory, event stream, command output, evaluator artifact, lease, state, pending experiment, and inbox. Preserve these artifacts before recovery.

## Common states

- **Paused**: report the reason; resume only when the user or recorded decision authorizes it.
- **Budget exhausted**: wait for reset or obtain an explicit budget change; do not edit counters.
- **Repeated failure**: move the item to the inbox after its retry cap and stop retrying unchanged work.
- **Expired lease**: verify the owning process/run is dead before recovery; avoid deleting a newly acquired lease.
- **Orphaned state-lock acquisition gate**: a path ending in `.lock.acquire` means a process may have crashed during the short acquire/reclaim doorway. Loop-Engineering deliberately does not auto-delete this gate. Stop every process using the loop, inspect its `owner.json`, confirm that owner is dead, back up the loop, and only then remove the gate; rerun `doctor`, validation, and a dry-run before resuming.
- **Ownerless or malformed canonical state lock**: fail closed. Current locks are published only after durable owner metadata exists, so a canonical `.lock` without valid `owner.json` is corruption or an unknown writer, not evidence that automatic deletion is safe.
- **State/strategy mismatch**: stop execution, retain both files, and recover from the last complete journal/archive.
- **Missing v1.0.2 integrity binding**: stop the Runner, confirm there is no active lease, back up the loop directory, and run `loopctl migrate <loop-dir>`; never synthesize generation, contract, or strategy digests by hand.
- **Pending experiment**: approve only the exact recorded digest or reject and create a new experiment.
- **Missing runtime**: install the versioned CLI or run from a source checkout; do not pretend commands succeeded.
- **Locked Part**: inspect `waitingOn`; never bypass the dependency or hand-edit state to make it eligible.
- **Goal Gate failed**: inspect exact failed Goal criteria and `affectedParts`; reopen only the recorded Parts and descendants through the recorder.
- **Completed**: the finite Goal Gate passed. Do not resume or schedule another run under the completed contract.

## Recovery rules

Choose the smallest reversible repair. Never delete the only run artifact, patch, strategy version, or human decision. Never hand-edit Work Plan progress, unlock a Part, or mutate approved Part definitions; a material plan change requires a parent-linked proposal revision and new human decision. After repair, rerun validation and one dry-run before enabling commands or cadence.

For a finite Part in `blocked` or `needs-human`, resolve the underlying prerequisite or authority question first, then use `loopctl part reopen <loop-dir> --id <part-id> --actor <human> --reason <text>`. The command binds the transition to the exact terminal run. `loopctl resume` alone is only a scheduler control and cannot reopen a Part.

For a final Goal Gate in `blocked` or `needs-human`, resolve the underlying issue and use `loopctl goal resolve <loop-dir> --actor <human> --reason <text>`. A generic resume cannot clear unresolved Goal attention, and an exhausted final-evaluation budget requires a reviewed contract revision.
