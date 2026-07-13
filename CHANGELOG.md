# Changelog / 更新日志

## v1.0.2 — Release hardening / 发布加固

- Added allowlisted multi-file transaction recovery for run/state recording and experiment approval, promotion, and rollback.
- Added explicit UTC budget dates, monotonic run time checks, immutable/idempotent run records, strict retry boundaries, and fail-closed missing/foreign state handling.
- Bound trusted `dry-run` and observed-overrun accounting to a live matching Runner lease; malformed or deceptive command drafts become counted terminal failures, and actual overruns retain their usage.
- Made lease acquire/recovery/renew/release fail closed and concurrency-safe, including malformed-lease and replacement-owner handling.
- Bound state and leases to a loop generation plus exact contract digest, anchored active/archived strategies by SHA-256, and added `loopctl migrate <loop-dir>` for verified v1.0.1 state migration.
- Required the configured evaluator identity, run-window timestamp, and real in-loop artifact path for task verdicts.
- Added unique per-case strategy evaluator evidence, digest-bound experiment attestations, immutable approval artifacts, and independent approver-role checks; failed candidate cases can never be promoted.
- Enforced configured run/failure triggers before staging a new experiment and limited each loop to one pending experiment.
- Split since-experiment triggers from since-promotion audit counters; every experiment attempt consumes its trigger window.
- Bound baseline/candidate arms and every case evaluation to exact strategy SHA-256 values, and bound Runner-produced run evidence to a lease-frozen active strategy.
- Added immutable human rejection decisions through `loopctl experiment reject`; pending review must resolve before rollback, and rejection requires fresh runs before another experiment.
- Made Runner wall-clock timestamps authoritative, made `budget-exceeded` accounting-only, and rejected accounting-date rollback during crash recovery.
- Made migration an idempotent verified no-op on current loops, invalidated legacy pending evidence safely, required continuous strategy archive ancestry, and added audited handling for expired remote leases.
- Added strict state/lease/experiment UTC time semantics, including evidence-before-staging-before-approval ordering.
- Aligned external PR/comment effects with human-only governance and clarified one-shot/deterministic Skill exit routes.
- Added digest-bound fresh-session review records, 100+ regression checks, real tarball and dual-Skill installation smoke tests, stale-runtime rejection, dependency-free Codex helper fallback coverage, reproducible install commands, and SHA-pinned CI actions.

Upgrade note: stop the Runner and run `loopctl migrate <loop-dir>` for every v1.0.1 loop before normal operation. Legacy pending strategy experiments are marked `invalidated` and must be rebuilt under a new experiment ID with v1.0.2 per-case evaluator attestations; prior approvals are intentionally not reused.

中文摘要：本版本重点修复并发状态丢失、预算绕过、伪 `dry-run`、lease 恢复、评估者冒名、真实路径越界和失败策略候选晋级等完整性问题，并加入 generation/契约/策略摘要绑定、受控迁移、进化触发门槛、行为评测、真实打包安装与可复现发布链路。

## v1.0.1

- Added pinned GitHub Skill metadata support and strict Claude marketplace compatibility.

## v1.0.0

- First complete Skill-first v1 release with the canonical Agent Skill, protocol schemas, local Runner, platform plugins, and benchmark-gated task-strategy evolution.
