# Roadmap

## v1.1 (current)

- Vague-idea intake with a verifiable Goal Contract, non-executable LoopProposal, explicit assumptions, at most three material questions, and honest readiness.
- Digest-bound human proposal decisions, parent-linked revisions, deterministic compilation, complete Goal/action traceability, persisted Goal Contracts, and tamper-evident proposal/candidate/Goal/reconstructable-decision provenance in `loop.yaml`.
- Optional fixed finite Work Plans for composite long-horizon outcomes: stable Parts, acyclic dependencies, exact Goal traceability, extensible evidence types, heterogeneous Part verification envelopes, artifact digest bindings, dependency-ready execution, retry-safe progression, independent final Goal evaluation, and a terminal `completed` lifecycle.
- One canonical, installable `loop-engineering` Agent Skill shared across platforms.
- Progressive references, deterministic runtime helper, self-contained assets, and behavior evals.
- Codex and Claude Code plugin/marketplace packaging.
- Portable protocol v1 with typed action gates and safe persistence paths.
- Evidence-bound run results with independent evaluator artifacts and SHA-256 verification.
- Loop-generation/contract bindings plus active and archived strategy digest anchors.
- Hard discovery, item, time, daily-run, and cost limits with serialized accounting.
- Local Runner with trusted dry-run/command boundaries, fail-closed leases, timeouts, events, and pause/resume.
- Recoverable, allowlisted transaction journals for run/state and experiment/approval/rejection/strategy transitions.
- Trigger-gated benchmark experiments, configured per-case evaluator attestations, matched digest-attributed strategy results, mechanically recomputed scores, one pending candidate, immutable human approvals/rejections, strategy archives, and rollback.
- Platform-specific loop-instance renderers and an explicitly non-operational GitHub Actions preflight scaffold.

## v1.x hardening

- Async process supervision with lease heartbeats and whole-process-group termination.
- Operator-facing journal inspection, recovery previews, and guided recovery commands; the underlying transaction journal and fail-closed automatic recovery are already implemented.
- Stronger runtime sandbox integrations for untrusted commands.
- Cryptographically signed evaluator/provenance attestations for remote runners.
- Provider-backed held-out Skill eval automation across Codex and Claude Code; v1.1.0 retains digest-bound fresh-session outputs and per-expectation review evidence.
- State-bound proposal revision and migration tooling for explicitly reviewed changes to an already-running fixed Work Plan.

## Later

- Provider-native Codex, Claude Code, and OpenClaw executors.
- Cron-expression and timezone-aware local scheduling.
- Optional GitHub, package-manager, and Playwright collectors.
- Richer workflow topology beyond the bounded fixed Work Plan, only when real workloads justify the added review and recovery surface.
- Remote control plane without weakening the portable local contract.
