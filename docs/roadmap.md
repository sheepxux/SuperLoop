# Roadmap

## v0.1.x (current)

- Portable `loop.yaml` protocol.
- Validator with safety checks.
- State initializer.
- Run planning (`loopctl next`) and run recording (`loopctl record`) with schema-checked state.
- Protocol artifact validation (`loopctl check`).
- Operational executor skills from a single content source, with drift checked by doctor.
- Practical examples.

## Runner (planned next)

- `loopd` long-running runner.
- Due-loop scanner for `.loop-engineering/loops`.
- Lease files to prevent duplicate runs.
- Event stream on top of recorded run logs.
- Runtime (not advisory) budget, retry, and human-gate enforcement.
- Worker rebuild with state inheritance: when a worker drifts, start a fresh one from persisted state instead of accumulating context.
- Adapter fixtures and golden-file tests.

## Later

- Process-level verification signals: mid-run checkpoints the evaluator can reject early, instead of one end-of-item verdict.
- Item dependency graphs, only if real loops outgrow the single-lane model (see [positioning.md](positioning.md) on loops vs topology).
- Optional GitHub API collector.
- Optional package manager collectors.
- Optional Playwright evaluator harness.
- Published adapter registry.
- Cloud runner control plane.
