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
- **State/strategy mismatch**: stop execution, retain both files, and recover from the last complete journal/archive.
- **Missing v1.0.2 integrity binding**: stop the Runner, confirm there is no active lease, back up the loop directory, and run `loopctl migrate <loop-dir>`; never synthesize generation, contract, or strategy digests by hand.
- **Pending experiment**: approve only the exact recorded digest or reject and create a new experiment.
- **Missing runtime**: install the versioned CLI or run from a source checkout; do not pretend commands succeeded.

## Recovery rules

Choose the smallest reversible repair. Never delete the only run artifact, patch, strategy version, or human decision. After repair, rerun validation and one dry-run before enabling commands or cadence.
