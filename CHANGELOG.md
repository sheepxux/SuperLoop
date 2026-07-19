# Changelog / 更新日志

## v2.0.0 — SuperLoop identity and protocol v2 / SuperLoop 完整命名与 v2 协议

- Renamed the npm package to `@sheepxux/superloop`, the canonical Skill and plugin ID to `superloop`, and the repository to `sheepxux/SuperLoop`.
- Introduced `apiVersion: superloop/v2` across contracts, state, evaluator evidence, proposals, decisions, strategies, and experiments.
- Moved the canonical runtime root to `.superloop/loops` and the administrative lock root to `.superloop-admin-locks`.
- Renamed the canonical Skill directory to `skills/superloop` and updated Codex, Claude Code, ChatGPT, OpenClaw, and generic-harness adapters.
- Treats the v1-to-v2 identity change as a contract migration: provenance-bound v1 contracts require a digest-linked proposal revision and fresh human approval; prior Part/Goal passes do not transfer automatically.
- Updated every current schema ID, installation example, package fallback, generated template, example, test, and release manifest to the SuperLoop v2 identity.

中文摘要：本版本完成 SuperLoop 的全量技术重命名：包名、Skill/插件标识、GitHub 地址、协议版本和持久状态目录全部进入新的正式命名。由于协议和路径属于获批契约的一部分，已有 v1 Loop 必须通过父提案相连的 revision、重新审批和新的 v2 初始化迁移，不能原地改写或自动继承既有通过状态。

## v1.1.0 — Idea-to-Loop design plane / 想法到循环设计层

- Added a first-class `Propose` mode that turns vague recurring ideas into evidence-bearing Goal Contracts and non-executable `LoopProposal` artifacts.
- Added a bounded intake policy: ask at most three questions that materially change routing, verification, permissions, or safety; record safe unknowns as explicit assumptions.
- Added proposal and proposal-decision schemas, templates, custom semantic/traceability validation, and CLI commands to validate, decide, and compile proposals.
- Added one domain-neutral finite Work Plan inside a Loop for composite outcomes: stable Parts, acyclic dependencies, exact Part acceptance, durable artifact bindings, and dependency-ready scheduling.
- Added optional Part-specific verification envelopes, extensible typed evidence names, and generic local/source/tool permissions so heterogeneous Parts can use domain-appropriate checks without creating domain-specific Skills.
- Added separate Part Gates and a distinct final Goal Gate; failed Parts cannot unlock dependents, final failure reopens affected Parts and descendants, and only a passing whole-Goal evaluation can complete the Loop.
- Required accepted Part artifacts to resolve to distinct regular files inside the Loop directory with recomputed SHA-256 matches; external deliverables retain a local export or receipt.
- Added immutable Part-result and Goal-run state anchors, audited `part reopen` / `goal resolve` recovery for blocked or human-required states, and exact failed-Goal-criterion tracing to affected Parts.
- Added complete finite-ledger causal replay so direct edits cannot reopen Parts, lower retry/Goal counters, resume unresolved attention, or forge completion; continuous streams retain their bounded recent ledger.
- Protected frozen `state.json` and `loop.yaml` from command-executor mutation by rejecting the draft, retaining evidence, restoring the preflight snapshot, and recording a counted failure.
- Added explicit continuous-stream versus finite-plan routing, a generic finite-project example, phase-aware adapters, and Work Plan protocol/runtime documentation without domain-specific behavior.
- Bound human proposal decisions to the exact proposal ID, revision, and canonical SHA-256; modified or unresolved proposals fail closed.
- Added digest-linked proposal revisions; revision 2 and later require the exact parent during validation, decision, and compilation.
- Made proposal compilation deterministic, persisted the complete Goal Contract, and embedded tamper-evident proposal/candidate/Goal/reconstructable-decision provenance in the resulting `loop.yaml`.
- Preserved approved contract identity during initialization: proposal-compiled loops require the exact `metadata.name`, `.loop-engineering/loops` root, and reviewed persistence paths.
- Preserved smaller one-shot and deterministic routes and kept proposal, evaluator, governance, runtime, and strategy-evolution trust boundaries separate.
- Added positive, negative, digest-tampering, readiness, and fresh-session behavior tests for the complete Idea-to-Loop path.

中文摘要：本版本把“模糊想法”升级为正式输入。Skill 先生成可验证 Goal 与不可执行 Loop 提案；只有人类确认假设和 prerequisites、审阅完整提案并批准精确摘要后，运行时才能确定性编译契约。有限复杂任务使用同一个 Loop 和通用 Work Plan 分 Part 推进，每个 Part 独立验收，全部通过后仍须经过最终 Goal Gate；持续任务则保留有界发现模式。编译产物保留完整 Goal Contract、可检出篡改的来源绑定和不可变持久化布局；提案设计、执行验收与权限授权互不冒充。

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
