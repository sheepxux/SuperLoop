# Protocol v1

Before `loop.yaml`, an optional but default Skill-first design protocol turns vague intent into a reviewable contract:

```text
source idea → LoopProposal → exact human LoopProposalDecision → deterministic compile → loop.yaml
```

`LoopProposal` is non-executable. It contains the preserved idea, suitability route, evidence-bearing Goal Contract, at most three material questions, assumptions, prerequisites, risks, readiness, a candidate Loop, and complete acceptance/action traceability. `ready-for-review` requires no blocking gap, an explicit risk level, a schema-valid candidate, exact Goal preservation, independent verification, and mappings from every permission/output to an actual gate.

`LoopProposalDecision` binds a human actor and outcome to the proposal ID, revision, and canonical SHA-256. The digest encoding is specified by [Canonical JSON and digest interoperability](canonical-json.md). Only `approve` for the exact `ready-for-review` proposal may compile. Compilation persists the complete Goal Contract and adds proposal, candidate Loop body, Goal Contract, and reconstructable human-decision provenance to `loop.yaml`; validation recomputes those bindings, so digest-inconsistent edits fail closed. Keep the source proposal and decision as the full review record and trusted comparison point. Local hashes provide integrity evidence, not writer authentication or a signature; enforceable installations must put approval behind their own identity-backed human channel. The runtime never uses Proposal as execution state.

The bundled proposal starter deliberately has `readiness: needs-input`. It is not a ready contract: a human must confirm or reject its assumptions, verify prerequisite status, and reconcile `readiness.blockers` before approval. For a changed proposal, lineage is mechanical rather than informal:

```bash
loopctl proposal revise proposal-v1.yaml --out proposal-v2.yaml
loopctl proposal validate proposal-v2.yaml --parent proposal-v1.yaml
loopctl proposal decide proposal-v2.yaml --parent proposal-v1.yaml --approve --actor <human> --reason <text> --out decision-v2.json
loopctl proposal compile proposal-v2.yaml --parent proposal-v1.yaml --decision decision-v2.json --out loop.yaml
```

The exact parent is mandatory for revision 2 and later at validation, decision, and compilation. A compiled contract must then be initialized with a name equal to `loop.yaml.metadata.name` and `--out .superloop/loops`; its approved `.superloop/loops/<name>/{state.json,runs/,inbox.md,decisions.md}` paths cannot be renamed or relocated during initialization.

After that boundary, `loop.yaml` is the immutable contract for a recurring stream or finite long-horizon agent workflow:

```text
goal → continuous discovery OR fixed Work Plan → handoff → verification → persistence → schedule → safety
```

Task strategy lives separately in `strategy.json`. A strategy candidate cannot modify the contract.

Direct expert authoring of `loop.yaml` is a compatibility route only when the user supplies an existing contract or explicitly requests it. A model must not use that route to bypass Proposal-first review for vague or new ideas.

## Required sections

- `metadata`: stable name, owner, description, risk, tags.
- `goal`: objective, acceptance, stop, and blocked conditions.
- `workPlan` (optional): fixed finite Parts, acyclic dependencies, exact Goal trace strings, Part criteria, optional Part-specific verification envelopes, expected artifacts, per-run Part cap, and independent completion policy.
- `discovery`: bounded sources, deterministic-first ranking, item cap.
- `handoff`: worker role, domain-neutral isolation (`worktree`, `branch`, `task-directory`, `thread`, or read-only `none`), typed generic/repository/external permissions, and prompt. `handoff.worktree` is required only for `worktree` or `branch`; non-code tasks do not need Git configuration.
- `verification`: independent evaluator, evidence types, commands, verdicts.
- `persistence`: repository-relative paths under the loop directory.
- `schedule`: runtime, cadence, timezone, timeout, concurrency.
- `runner` (optional): dry-run or command executor.
- `safety`: budgets, retries, typed action gates, failure policy.
- `evolution` (optional): external task-strategy experiment policy.
- `outputs`: expected durable artifacts.

## Mechanical safety checks

The proposal validator rejects untracked acceptance criteria, ungoverned permissions/outputs, hidden goal additions, incorrect blockers, more than three questions, loop candidates on smaller routes, and ready proposals with unresolved gaps. The loop validator rejects self-evaluation, writes without isolation, discovery above the item budget, timeouts above the runtime budget, unsafe paths or branch prefixes, high-risk permissions without exact human-only action IDs, duplicate gate IDs, missing executable verification, and automatic promotion for non-low-risk loops. A finite Work Plan additionally rejects duplicate IDs, unknown/self/cyclic dependencies, Parts that cannot reach a terminal sink, missing Goal-criterion coverage, Part evidence outside that Part's effective verification envelope, executable Part evidence without commands, a Part cap above existing budgets, and a completion evaluator equal to either the worker or the Part evaluator.

Human gate entries are typed IDs such as `open-pull-request`, `merge-pull-request`, `deploy-production`, and `change-permissions`; substring matches are not accepted.

## Run evidence

`loopctl record` accepts terminal logs only. Each attempted item binds:

- a schema-valid evaluator artifact stored inside the loop directory;
- evaluator identity and independent context ID;
- loop, item, and verdict equality;
- the artifact SHA-256;
- every configured evidence type and successful command for a passing result.

The recorder rejects duplicate/unknown item IDs, terminal-state overwrites, retry-exhausted work, `passed` with no results, aggregate status/verdict mismatches, duplicate command evidence, malformed/future/regressing timestamps, discovery/cost/time/item overruns, missing or foreign state, evaluator identity mismatch, real-path escape, and daily budget bypasses. A dedicated accounting date cannot move backward and recovery derives it from immutable completion evidence. The continuous-stream state ledger retains a bounded recent window, while a finite Work Plan retains the complete immutable run ledger required for causal replay. Both bind run IDs and exact artifact paths to immutable digests, so identical replay is idempotent but revalidates evaluator evidence; pre-created or missing artifacts fail closed. Only the trusted dry-run Runner may record `dry-run`. For command execution, the Runner supplies the authoritative start/finish clock and active strategy binding. Observed overruns are durably charged as accounting-only `budget-exceeded` records with no discovered items or task results.

State and leases bind a loop-generation identifier and the exact `loop.yaml` SHA-256. Evolution-enabled attempted runs also bind the exact active strategy version and SHA-256. Evidence produced before a promotion cannot be recorded against the new strategy or counted toward its observations and triggers.

## Finite Work Plans

`workPlan.mode: finite` keeps one Loop and one Goal Contract for a composite outcome. Each Part has a stable ID, objective, explicit `dependsOn` edges, exact strings copied from `goal.acceptanceCriteria`, its own evidence-bearing acceptance criteria, declared expected artifacts, and an optional Part-specific verification envelope. Evidence identifiers use safe typed names so domains may declare checks such as `citation-review` or `continuity-review`. Eligible failed retries take precedence over untouched Parts; array order is the deterministic tie-break within each class. The plan remains part of the immutable candidate Loop body and exact proposal approval.

`loopctl next` adds a mechanical phase:

- `work`: only returned `eligibleParts` may run; `lockedParts` remain unavailable. Every result binds the exact Part-definition SHA-256 and every declared artifact ID/reference/digest. Each accepted reference must resolve to a distinct, run-specific regular-file snapshot inside the Loop directory and its bytes must match the declared SHA-256. Accepted snapshots are immutable; a corrected attempt emits a new reference rather than overwriting evidence. A passing evaluator artifact must cover all exact Part criterion IDs plus that Part's `verification` evidence/commands, or the Loop-level envelope when the Part omits an override.
- `goal-evaluation`: every Part passed. No discovery or Part result is allowed; the run binds a schema-valid independent Goal evaluation to `goalEvaluationBasisSha256` and covers every exact whole-Goal criterion.
- `completed`: a passing Goal Gate was recorded. The Loop is terminal and cannot accept another run.

A failed Part remains inside its retry policy and cannot unlock dependents. A failed Goal Gate records `affectedParts`; only those Parts and their descendants reopen. Blocked or `needs-human` evaluation stops. The recorder rejects out-of-plan IDs, stale Part digests, missing artifact bindings, premature Goal evaluation, Part work during Goal evaluation, and any run after completion.

Changing a Part, dependency, artifact, criterion, bound, or completion policy is a contract change, not runtime progress. Stop and create a parent-linked proposal revision; never silently mutate the approved plan.

## Strategy experiments

A new experiment may be staged only after the configured `afterRuns` or `consecutiveFailures` trigger is due, and a loop may hold only one pending experiment. The trigger uses counters since the last experiment attempt, while since-promotion counters remain separate audit data. An experiment includes a benchmark manifest and digest, stable case IDs, matched baseline/candidate case results, exact baseline/candidate strategy SHA-256 values, per-case arm/strategy bindings, artifacts and digests, configured evaluator identity/context/command evidence, a digest-bound experiment attestation, and a promotion recommendation. Scores are recomputed from per-case results, artifact contents must match their recorded case fields, and any failed candidate case disqualifies promotion regardless of aggregate score or approval.

For human-reviewed promotion:

1. `loopctl evolve` stages the exact experiment digest.
2. `loopctl approval create` produces an approval bound to that digest.
3. `loopctl evolve --approval` verifies state, staged file, digest, baseline, approver, and timestamp.

If the reviewer rejects it, `loopctl experiment reject` writes an immutable digest-bound decision with actor, time, and reason, marks history `abandoned`, clears pending, and consumes the trigger. A new experiment requires fresh attributable runs. A pending experiment must be approved or rejected before rollback.

Promotion archives both strategies and the exact approval artifact. Staging time must follow all case/top-level evaluation evidence, and approval time must follow both evidence and staging. `loopctl strategy rollback` restores archived behavior as a new version and records actor, reason, and time. Run/state and experiment/approval/decision/strategy changes use an allowlisted recovery journal so a process interruption cannot leave an accepted artifact without its matching accounting state.

The runtime rejects an approver string equal to any configured worker or evaluator identity. The string itself is still a local audit assertion, not authenticated identity or a digital signature; deployments that need enforceable governance must add their own identity-backed approval channel.

## SuperLoop v2 identity migration

SuperLoop v2 changes the canonical package, Skill identifier, protocol version, and state root. A Loop created under `loop-engineering/v1` or stored below `.loop-engineering/loops` is therefore not opened in place as a `superloop/v2` Loop. Stop the old Runner, preserve the complete legacy directory as evidence, and create a parent-linked proposal revision that records the intended migration. After fresh human approval, compile and initialize that revision under `.superloop/loops`.

The v2 Loop receives a new generation, contract digest, state ledger, and approval chain. Legacy run artifacts remain attributable historical evidence, but Part/Goal passes, pending experiments, strategy approvals, leases, and completion state do not transfer automatically. This prevents a new protocol identity from inheriting claims that were approved and evaluated under a different contract.

`loopctl migrate` repairs missing integrity anchors inside a supported protocol generation; it does not convert a v1 contract or state directory into v2.

## Historical v1.0.1 migration

Before a v1.0.2 runtime operates an existing loop, stop its Runner and run `loopctl migrate <loop-dir>`. Migration adds generation/contract bindings and anchors an exact continuous `v1..active` strategy chain; orphan/future archives, broken parents, active owners, or contract/version/digest inconsistencies fail closed. A repeat migration on a current consistent loop is a no-op. A legacy pending experiment is marked `invalidated`; rebuild it under a new experiment ID with v1.0.2 per-case attestations and never reuse its old approval. Remote or unverifiable expired leases require operator verification plus `--retire-expired-lease`; a live same-host PID is never retired.

## Enforcement boundary

Schema checks, typed gates, budgets, hashes, state transitions, leases, and timeouts are mechanical. Natural-language intent and local command permissions are not an OS sandbox. Keep privileged credentials away from unattended loops and preserve human-only governance for external effects.
