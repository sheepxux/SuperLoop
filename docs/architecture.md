# Loop-Engineering v1 Architecture

## Product boundary

Loop-Engineering is a complete Agent Skill plus a portable local reference runtime. The Skill decides whether to use a loop and guides design, execution, review, recovery, and measured strategy evolution. The runtime enforces the deterministic parts of that contract.

## Layers

```text
┌─────────────────────────────────────────────────────────────┐
│ canonical Skill: trigger, suitability, routing, invariants │
├─────────────────────────────────────────────────────────────┤
│ references + assets + evals: progressive expertise         │
├─────────────────────────────────────────────────────────────┤
│ loop.yaml: immutable objective, verification, safety       │
├─────────────────────────────────────────────────────────────┤
│ strategy.json: versioned, experimentally mutable behavior  │
├─────────────────────────────────────────────────────────────┤
│ loopctl: validate, plan, record, evolve, approve, rollback  │
├─────────────────────────────────────────────────────────────┤
│ loopd: cadence, leases, execution, events, persistence      │
├─────────────────────────────────────────────────────────────┤
│ platform plugins and per-loop instance Skills              │
└─────────────────────────────────────────────────────────────┘
```

## Canonical Skill package

```text
skills/loop-engineering/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── suitability-and-patterns.md
│   ├── contract-design.md
│   ├── execution-and-evaluation.md
│   ├── runtime-integrations.md
│   ├── strategy-evolution.md
│   ├── safety-and-governance.md
│   └── troubleshooting.md
├── scripts/run-loopctl.mjs
├── assets/
└── evals/evals.json
```

`SKILL.md` contains only the routing workflow and hard invariants. Detailed guidance loads only for the selected mode. Assets are canonical; `templates/` is a checked compatibility mirror.

## Product Skill versus instance Skill

The product Skill handles the lifecycle across loops. A rendered instance Skill binds one `loop.yaml` and teaches one platform how to execute exactly one iteration. Instance generation never replaces the product Skill.

## Trust boundaries

1. **User/operator**: grants authority and owns human-only decisions.
2. **Worker**: may create a candidate in declared isolation; cannot issue the final verdict.
3. **Evaluator**: receives inspectable artifacts, not private reasoning; emits schema-valid evidence.
4. **Recorder**: verifies bindings, hashes, status, budgets, and state before persistence.
5. **Strategy evaluator**: compares baseline and candidate on the same frozen benchmark.
6. **Runner**: schedules and executes with current OS permissions; it is not a sandbox.

## Persistence

```text
.loop-engineering/loops/<name>/
├── loop.yaml
├── state.json (generation, contract digest, strategy anchors, ledgers)
├── strategy.json
├── strategies/v<N>.json
├── experiments/<id>.json
├── evaluators/<artifact>.json
├── inbox.md
├── decisions.md
├── locks/active-run.json
├── locks/state-transaction.json (present only during commit/recovery)
└── runs/<run-id>/
```

JSON/YAML writes use same-directory temporary files, file `fsync`, atomic rename, and directory `fsync` where the platform supports it. A validated, allowlisted journal makes run/state recording and experiment staging/approval/rejection/promotion/rollback recoverable across process interruption, including partially applied writes. State includes bounded run and experiment artifact ledgers; state mutations, stale-lock recovery, and lease operations are serialized independently, and malformed or ledger-inconsistent artifacts fail closed. Strategy, approval, and rejection-decision artifacts make review, promotion, and rollback auditable. Async in-flight lease heartbeats remain a future reference-runtime improvement.

Every v1.0.2 loop state carries a generation identifier and the exact `loop.yaml` SHA-256. Leases copy both bindings, so a stale runtime handle or a force-reinitialized loop cannot commit into a different generation or contract. Evolution state separately anchors the active strategy and every retained strategy archive by version and SHA-256; attributable run evidence, benchmark arms, and case evaluations bind exact strategy digests. Trigger counters since the last experiment are distinct from since-promotion audit counters.

Existing v1.0.1 loop directories must be migrated with `loopctl migrate <loop-dir>` after stopping the Runner. Migration verifies the contract, active strategy, and continuous archive parent chain before writing new anchors. It marks an old pending experiment `invalidated`; rebuild it with a new ID in v1.0.2 format. Running migrate on a current consistent loop is a no-op and cannot clear pending review.

## Evolution boundary

Only `strategy.json.instructions` is evolvable. The benchmark and evidence establish whether a candidate was better on observed cases; they do not prove universal improvement. Promotion requires a configured threshold and, except for explicitly low-risk automatic mode, digest-bound human approval. Human rejection is also digest-bound and immutable; neither path changes model weights.

## Non-goals

- autonomous model-weight training;
- automatic merge or deployment;
- hiding external effects behind evaluator approval;
- replacing domain Skills such as GitHub, security review, or browser testing;
- pretending the GitHub Actions scaffold is an executor;
- distributed orchestration or a production sandbox.
