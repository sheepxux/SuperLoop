# SuperLoop Architecture

## Product boundary

SuperLoop is a complete Agent Skill plus a portable local reference runtime. The Skill turns vague ideas into verifiable goals, decides whether a loop is appropriate, and guides continuous discovery or finite long-horizon Work Plans, execution, review, recovery, and measured strategy evolution. The runtime enforces the deterministic parts of the reviewed contract.

The Skill and runtime meet at explicit artifacts. Model judgment may draft a proposal; it may not silently turn that proposal into execution authority.

## Lifecycle

```text
vague idea
   │
   ▼
suitability routing ── one-shot ─────► direct bounded action
   │                 └ deterministic ► script / job / query / alert
   │
   ▼ agentic or safely redesigned
LoopProposal
  ├─ Goal Contract
  ├─ candidate loop contract
  │    └─ continuous discovery OR fixed finite Work Plan
  ├─ assumptions + ≤3 material questions
  ├─ prerequisites + traceability
  └─ readiness: needs-input | ready-for-review | not-applicable
   │
   ▼ exact canonical SHA-256
human LoopProposalDecision
  ├─ approve | reject | request-changes
  ├─ actor + reason
  └─ exact proposal digest
   │
   ▼ approved + digest-matched + ready-for-review only
deterministic compiler
   │
   ▼
loop.yaml ─► scaffold ─► bounded runs ─► evidence + durable state
                          │
                          ├─ continuous: discover → work → evaluate
                          └─ finite: eligible Part → Part Gate
                                      └─ all Parts pass → Goal Gate → completed
   │                                      │
   └──────── immutable controls ◄─────────┘
                                          │
                                          ▼
                         matched strategy experiments
                                          │
                                          ▼ digest-bound human gate
                                  promote or reject strategy
```

The proposal is non-executable. Its readiness status is a design signal, not consent. The proposal decision authorizes deterministic contract compilation only; it does not bypass the runtime's per-action human gates. Evaluator evidence establishes technical quality, while human decisions establish authority.

## Layers

```text
┌────────────────────────────────────────────────────────────────┐
│ canonical Skill: intake, suitability, modes, hard invariants  │
├────────────────────────────────────────────────────────────────┤
│ proposal plane: Goal + discovery/Work Plan + traceability    │
├────────────────────────────────────────────────────────────────┤
│ decision plane: human actor + exact proposal digest           │
├────────────────────────────────────────────────────────────────┤
│ deterministic compiler: approved proposal -> loop.yaml        │
├────────────────────────────────────────────────────────────────┤
│ loop.yaml: immutable Goal, optional Work Plan, and safety     │
├────────────────────────────────────────────────────────────────┤
│ strategy.json: versioned, experimentally mutable behavior     │
├────────────────────────────────────────────────────────────────┤
│ loopctl: validate, compile, plan, record, approve, rollback    │
├────────────────────────────────────────────────────────────────┤
│ loopd: cadence, leases, execution, events, persistence         │
├────────────────────────────────────────────────────────────────┤
│ platform plugins and per-loop instance Skills                 │
└────────────────────────────────────────────────────────────────┘
```

## Proposal plane

`LoopProposal` is the default entry for a vague or not-yet-approved recurring or finite long-horizon idea. It preserves the raw intent and makes uncertainty explicit through assumptions, material questions, prerequisites, and readiness. Its Goal Contract describes the observable outcome, acceptance evidence, non-goals, stop conditions, and blocked conditions. Its candidate contract recommends the smallest complete loop shape: bounded discovery for a continuous stream, or one fixed Work Plan for a finite composite outcome.

The proposal plane enforces four boundaries:

1. classify one-shot and deterministic work before introducing agent orchestration;
2. ask no more than three questions, and only when answers change the goal, evidence, authority, bounds, or integrations;
3. continue with explicit assumptions only when doing so does not invent risky authority;
4. stop for human review before compilation, scaffolding, scheduling, or execution.

Revisions carry a monotonic revision and the parent proposal digest. This makes a change-request chain reviewable without treating natural-language similarity as identity. The bundled starter proposal is intentionally `needs-input`; an operator must not approve it until a human confirms or rejects its assumptions, verifies its prerequisites, and reconciles blockers/readiness with those facts.

The CLI preserves this chain explicitly:

```bash
loopctl proposal revise proposal-v1.yaml --out proposal-v2.yaml
loopctl proposal validate proposal-v2.yaml --parent proposal-v1.yaml
loopctl proposal decide proposal-v2.yaml --parent proposal-v1.yaml --approve --actor <human> --reason <text> --out decision-v2.json
loopctl proposal compile proposal-v2.yaml --parent proposal-v1.yaml --decision decision-v2.json --out loop.yaml
```

Revision 2 and later require the exact parent during validation, decision, and compilation. Revision 1 has no parent.

## Decision and compilation plane

`LoopProposalDecision` binds a human actor, outcome, reason, and the exact canonical proposal SHA-256. The encoding is the frozen [Canonical JSON algorithm](canonical-json.md), not YAML bytes. Any proposal edit invalidates the prior decision by design. The reference CLI records a local actor assertion; it does not authenticate identity or prove consent, so enforceable deployments must supply an identity-backed approval channel.

The compiler accepts only an `approve` decision for the exact `ready-for-review` proposal. It copies the approved candidate contract—including every fixed Work Plan Part, dependency, expected artifact, Part Gate, and Goal Gate—into `loop.yaml` deterministically and persists the complete approved Goal Contract at `goalContract`. Provenance records the proposal ID/revision/digest, candidate Loop body digest, Goal Contract digest, and the human approval fields plus approval digest. Those retained fields reconstruct the exact approval artifact, while loop validation recomputes all embedded body/Goal/decision bindings. The result is tamper-evident when checked against the retained proposal/decision or another trusted digest. These local hashes detect inconsistent edits but are not signatures and do not authenticate a writer who can rewrite both content and digests.

The compiler cannot answer open questions, invent defaults, widen permissions, change acceptance evidence, or add an integration. If compilation would require judgment, the proposal must be revised and reviewed again.

The expert direct-`loop.yaml` path remains backward-compatible only for a user-supplied existing contract or an explicit user request for expert direct authoring. An agent cannot move a vague or new idea onto that path unilaterally. It skips proposal ergonomics, not validation, evaluator independence, safety, or human-action gates.

## Canonical Skill package

```text
skills/superloop/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── idea-to-loop.md
│   ├── suitability-and-patterns.md
│   ├── work-plans.md
│   ├── contract-design.md
│   ├── execution-and-evaluation.md
│   ├── runtime-integrations.md
│   ├── strategy-evolution.md
│   ├── safety-and-governance.md
│   └── troubleshooting.md
├── scripts/run-loopctl.mjs
├── assets/
│   ├── proposal.yaml
│   ├── proposal-decision.json
│   ├── loop.yaml
│   └── ...
└── evals/evals.json
```

`SKILL.md` contains routing, mode workflows, artifact links, and hard invariants. Detailed guidance loads only for the selected mode. Assets are canonical; `templates/` is a checked compatibility mirror.

## Product Skill versus instance Skill

The product Skill handles the lifecycle across ideas and loops. A rendered instance Skill binds one approved `loop.yaml` and teaches one platform how to execute exactly one iteration. Instance generation never replaces the product Skill and never inherits authority from proposal approval.

## Trust boundaries

1. **User/operator**: defines intent, grants authority, approves the exact proposal, and owns runtime human-only decisions.
2. **Proposal author**: may interpret an idea into a Goal Contract and candidate loop; cannot approve or execute it.
3. **Proposal decision recorder**: canonicalizes and digest-binds the human decision; cannot change proposal content.
4. **Compiler**: maps an approved proposal deterministically; cannot make design judgments.
5. **Worker**: may create one candidate item or eligible Part in declared isolation; cannot issue the final technical verdict.
6. **Part evaluator**: checks only the active Part's exact criteria and declared artifact bindings; cannot complete the whole Goal.
7. **Goal evaluator**: after every Part passes, checks every exact whole-Goal criterion against the integrated digest-bound basis.
8. **Recorder**: verifies eligibility, bindings, hashes, status, budgets, phases, and state before persistence.
9. **Strategy evaluator**: compares baseline and candidate on the same frozen benchmark.
10. **Runner**: schedules and executes with current OS permissions; it is not a sandbox.

## Runtime persistence

A provenance-bound compiled contract is initialized without mutation: the `loopctl init <name>` argument must exactly equal `loop.yaml.metadata.name`, and `--out` must be `.superloop/loops`. Its reviewed persistence fields must point to the matching root below. Changing a name or path requires proposal revision and a new human approval.

```text
.superloop/loops/<name>/
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

At minimum, every proposal-compiled loop preserves `.superloop/loops/<name>/{state.json,runs/,inbox.md,decisions.md}` exactly as approved. Evolution-enabled loops additionally preserve their reviewed strategy and experiment paths.

JSON/YAML writes use same-directory temporary files, file `fsync`, atomic rename or exclusive no-clobber hard-link publication, and directory `fsync` where the platform supports it. A validated, allowlisted journal makes run/state recording and experiment staging/approval/rejection/promotion/rollback recoverable across process interruption, including partially applied writes. Continuous state keeps a bounded recent-run ledger; finite Work Plans retain their full immutable run ledger so Part status, retries, resolutions, Goal attempts, and completion can be causally replayed. State lock publication and stale recovery share an atomic acquisition gate so a delayed stale-owner check cannot remove a newer owner; an orphaned gate fails closed for manually verified cleanup instead of recursively auto-reclaiming itself. Lease operations are serialized separately, and malformed or ledger-inconsistent artifacts fail closed. Strategy, approval, and rejection-decision artifacts make review, promotion, and rollback auditable. Async in-flight lease heartbeats remain a future reference-runtime improvement.

For a finite Work Plan, initialization creates one state item for every approved Part in contract order plus an active lifecycle. `loopctl next` derives dependency-ready and locked Parts, and binds each eligible Part to its exact definition digest. A Part may declare its own evidence/command envelope; otherwise it inherits the Loop-level verification envelope. Passing Part evidence retains the exact expected artifact IDs, references, and SHA-256 values; every reference resolves to a distinct regular file inside the Loop directory and is rehashed on acceptance and later state reads. After every Part passes, the lifecycle moves to `goal-evaluation`; the independent Goal artifact binds the complete contract/Part/artifact basis and covers every exact Goal criterion against the full approved completion envelope. Only a passing Goal Gate writes `completedAt` and makes the Loop non-runnable. A blocked or human-required Part/Goal stays non-runnable until an audited recovery command binds a distinct actor and reason to the exact attention run.

Every SuperLoop v2 state carries a generation identifier and the exact `loop.yaml` SHA-256. Leases copy both bindings, so a stale runtime handle or a force-reinitialized loop cannot commit into a different generation or contract. Evolution state separately anchors the active strategy and every retained strategy archive by version and SHA-256; attributable run evidence, benchmark arms, and case evaluations bind exact strategy digests. Trigger counters since the last experiment are distinct from since-promotion audit counters.

A legacy `loop-engineering/v1` directory is immutable migration input, not an in-place v2 state directory. After stopping the old Runner and backing up its complete state, create a parent-linked proposal revision, obtain a fresh human decision, then compile and initialize a new `superloop/v2` generation under `.superloop/loops`. Historical evidence may be referenced, but accepted Part/Goal results, experiments, approvals, leases, and completion state are not copied into the new ledger.

Within a supported protocol generation, `loopctl migrate <loop-dir>` verifies the contract, active strategy, and continuous archive parent chain before adding missing integrity anchors. It invalidates an old pending experiment whose evidence lacks required attribution. Running it on a current consistent loop is a no-op and cannot clear pending review; it is not a v1-to-v2 identity converter.

## Evolution boundary

Only `strategy.json.instructions` is evolvable. The benchmark and evidence establish whether a candidate was better on observed cases; they do not prove universal improvement. Promotion requires a configured threshold and, except for explicitly low-risk automatic mode, digest-bound human approval. Human rejection is also digest-bound and immutable; neither path changes model weights.

Proposal revision and strategy evolution solve different problems. Proposal revision changes the reviewed Goal Contract or loop design before compilation. Strategy evolution improves how an approved loop attempts the same task while preserving objective, evidence, permissions, budgets, and gates.

## Non-goals

- autonomous model-weight training;
- treating vague intent as blanket permission;
- automatically approving a model-authored proposal;
- automatic merge or deployment;
- hiding external effects behind evaluator approval;
- replacing domain Skills such as GitHub, security review, or browser testing;
- pretending the GitHub Actions scaffold is an executor;
- silently mutating an approved Work Plan or carrying accepted state into a changed Part without a reviewed transition;
- distributed orchestration or a production sandbox.
