# Roadmap

## v0.3.x (current)

- Portable `loop.yaml` protocol.
- Validator with safety checks.
- State initializer.
- Run planning (`loopctl next`) and run recording (`loopctl record`) with schema-checked state.
- Protocol artifact validation (`loopctl check`).
- Operational executor skills from a single content source, with drift checked by doctor.
- Practical examples.
- Versioned task strategies stored outside the immutable loop contract.
- Metric-triggered strategy experiments with matched baseline/candidate samples.
- Independent benchmark evidence and threshold-gated promotion (`loopctl evolve`).
- Human-reviewed promotion by default; automatic promotion only for explicitly low-risk loops.
- Local `loopd` scheduler with one-shot and continuous polling modes.
- Atomic leases, expired-run recovery, command timeout, durable run directories, and event logs.
- Dry-run plus explicit opt-in command executor.
- Status, run listing, pause, and resume controls.

## Runner extensions (planned next)

- Provider-native Codex, Claude Code, and OpenClaw executors.
- Cron-expression and timezone-aware scheduling.
- First-class human gate files and approval commands.
- Runtime permission sandboxing beyond the current explicit command opt-in.
- Worker rebuild with state inheritance when a worker drifts.

## Later

- Process-level verification signals: mid-run checkpoints the evaluator can reject early, instead of one end-of-item verdict.
- Item dependency graphs, only if real loops outgrow the single-lane model (see [positioning.md](positioning.md) on loops vs topology).
- Optional GitHub API collector.
- Optional package manager collectors.
- Optional Playwright evaluator harness.
- Published adapter registry.
- Cloud runner control plane.
