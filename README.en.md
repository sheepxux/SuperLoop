<p align="center">
  <img src="docs/assets/cover.png" alt="SuperLoop" width="720">
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

# SuperLoop

An installable advanced Agent Skill with a local reference runtime that supports it.

SuperLoop first compiles a vague idea into a reviewable goal, then governs recurring or finite long-horizon agent work with an explicit, auditable engineering contract:

```text
vague idea → Goal Contract + LoopProposal (non-executable)
                        → exact human digest approval → loop.yaml → continuous discovery or fixed Work Plan
                                                            → Part Gate → persistence → next Part
                                                            → final Goal Gate → completed
                                                                                                 ↓
                                                                          matched benchmark → promote or roll back
```

Its primary product is the complete Skill under `skills/superloop`. `loopctl`, `loopd`, protocol schemas, and platform plugins are the deterministic execution foundation for that Skill.

## Current Version: v2.0.0

> **Breaking v2 change:** the canonical identities are now `@sheepxux/superloop`, `$superloop`, `superloop/v2`, `.superloop/loops`, and `github.com/sheepxux/SuperLoop`. A v1 Loop's protocol and persistence paths are part of its approved contract, so existing loops require a parent-linked proposal revision, fresh human approval, and a new v2 initialization. Do not rewrite an approved v1 contract in place or automatically carry prior Part/Goal passes into v2.

`v2.0.0` adds the Idea-to-Loop design plane. The Skill turns a vague idea into an evidence-bearing Goal Contract and a non-executable `LoopProposal`, asking at most three questions that materially change the design. A human decision binds the proposal's exact SHA-256 before the runtime can deterministically compile `loop.yaml`. A changed proposal, unresolved blocker, or digest mismatch fails closed. Digests use a frozen [Canonical JSON algorithm](docs/canonical-json.md) that external approval systems can reproduce.

Compilation persists the complete Goal Contract at `loop.yaml.goalContract`. `metadata.provenance` binds the source proposal, approved candidate Loop body, and Goal Contract digests, and retains the fields and digest needed to reconstruct the human approval. `loopctl validate` recomputes those bindings. With the original proposal/decision or another trusted digest retained, the compiled contract is tamper-evident; local hashes provide integrity evidence, not a signature or identity proof.

A finite composite task uses one Loop and one Goal Contract. A fixed Work Plan decomposes the complete outcome into Parts with dependencies, expected artifacts, and exact acceptance criteria. Each Iteration attempts one eligible Part; an independent Part Gate must pass before progress unlocks. Different Parts may declare their own evidence types and verification commands, inheriting the Loop-level defaults only when no Part override exists. After every Part passes, a separate independent Goal Gate checks every whole-Goal acceptance criterion, and only that gate can enter `completed`. Parts are derived from the approved Goal rather than a writing, software, research, migration, or other domain preset.

The v1.0.2 local Runner, independent evaluation, durable state, transaction recovery, budgets, human gates, and controlled strategy evolution remain intact. Schema validity proves structure and cross-field invariants; human review and independent Skill evals still judge semantic intent quality.

“Evolution” means benchmark-gated task-strategy optimization. It does not modify model weights and cannot weaken the safety contract.

## What the Skill Does

When the input is still an idea, the Skill defaults to `Propose`: it preserves the original intent, records assumptions, and produces a verifiable goal plus a suggested loop shape without creating runtime state or taking external action. It also classifies the request:

- `one-shot`: it fits one bounded execution and evaluation context; do it directly without a loop.
- `deterministic`: prefer a script, CI job, or cron entry.
- `agentic-loop`: design a loop for recurring judgment or a finite long-horizon outcome that needs multiple independently verified Parts.
- `unsafe-loop`: add human gates or refuse unattended execution.

For suitable work, it routes among eight modes: propose, assess, design, scaffold, run, review, recover, and evolve. `Propose` and `Design` never silently expand into `Scaffold` or `Run`.

## Complete Capabilities

- Standard Agent Skills layout: `SKILL.md`, `agents/openai.yaml`, `references/`, `scripts/`, `assets/`, and `evals/`.
- One canonical Skill for Codex and Claude Code, avoiding duplicated instruction sources.
- Codex and Claude Code plugin/marketplace manifests plus source and npm installation fallbacks.
- Portable `loop.yaml` contract with JSON Schema and custom safety validation.
- Non-executable `LoopProposal`, evidence-bearing Goal Contract, no more than three material questions, explicit assumptions, and prerequisite/readiness quality gates.
- Separate `LoopProposalDecision`; approve, reject, and request-changes decisions bind the proposal ID, revision, and canonical SHA-256 before deterministic compilation of a provenance-bearing `loop.yaml`.
- Optional universal finite Work Plans with stable Part IDs, acyclic dependencies, exact Goal traceability, extensible evidence types, heterogeneous Part verification commands, artifact digest bindings, dependency-ready advancement, and an independent final Goal Gate.
- `loopctl next` exposes `work`, `goal-evaluation`, or `completed`; failed Parts retain their retry boundary, locked Parts cannot be skipped, and a failed final evaluation reopens only evidence-linked Parts and descendants.
- Durable state, run planning, pause/resume, retry queues, human inboxes, and audit logs. Continuous streams retain the latest 1,000 run summaries; finite Work Plans retain the complete run ledger required for causal replay.
- State and leases bind the loop generation and exact contract digest; evolution runs plus active/archived strategies bind versions and SHA-256, so stale work cannot commit across generations.
- Every task result must bind an independent evaluator artifact, context ID, and SHA-256; empty results cannot masquerade as success.
- Item, discovery, per-run time, daily run, and per-run cost budgets fail closed; concurrent records cannot lose or bypass accounting.
- Work already consumed beyond a command budget is persisted as an accounting-only `budget-exceeded` record and charged to daily run, time, and cost counters. It does not write task results or evolution metrics, and cannot disappear when a draft is rejected.
- Only the trusted dry-run Runner may write observational records; a real command executor cannot disguise execution as an uncounted `dry-run`.
- Local `loopd` Runner with serialized state updates, fail-closed atomic leases, trusted run-time boundaries, timeouts, event streams, and isolated run directories.
- Fixed benchmark manifests, matched case IDs, baseline/candidate strategy digests, and per-case arm/strategy-digest/evaluator identity/context/command evidence bindings.
- New experiments require a configured run-count or consecutive-failure trigger, and each loop may hold at most one pending experiment.
- Aggregate scores are mechanically recomputed from case results instead of trusting reported totals.
- Human approval and rejection bind the exact staged experiment SHA-256; rejection writes an immutable decision and requires new real-run evidence before another experiment.
- Every strategy version is archived as a continuous parent chain. Rollback restores prior behavior as a new monotonic version without rewriting history and is blocked while an experiment is pending.
- Per-loop Codex/Claude Skills, ChatGPT advisory instructions, and OpenClaw/generic harness adapters.
- GitHub Actions generates an explicitly labeled read-only preflight scaffold, not a fake operational executor.

See the validated [generic finite Work Plan example](examples/finite-project/loop.yaml) and its [non-executable Proposal example](examples/idea-to-loop/finite-project.proposal.yaml). They use only Goal, Parts, dependencies, Part Gates, and a final Goal Gate—no writing or other domain-specific behavior.

## Install the Skill

### GitHub Skill (recommended; GitHub CLI currently marks this capability as preview)

```bash
gh skill install sheepxux/SuperLoop superloop@v2.0.0 --agent codex
gh skill install sheepxux/SuperLoop superloop@v2.0.0 --agent claude-code
```

### Codex plugin

```text
codex plugin marketplace add sheepxux/SuperLoop --ref v2.0.0
codex plugin add superloop@superloop
```

### Claude Code plugin

```text
claude plugin marketplace add sheepxux/SuperLoop@v2.0.0
claude plugin install superloop@superloop
```

### Install and validate from source

```bash
git clone --branch v2.0.0 https://github.com/sheepxux/SuperLoop.git
cd SuperLoop
npm ci
node ./bin/loopctl.js skill validate

# Project scope; use --scope user for a user-level installation
node ./bin/loopctl.js skill install both --scope project
```

After the publisher completes the optional npm registry release, you can also use:

```bash
npm install --global @sheepxux/superloop@2.0.0
loopctl skill install both --scope user
```

## Quick Start

These commands use the pinned GitHub `v2.0.0` runtime directly, so plugin installation does not need to place `loopctl` on `PATH`. In a source checkout, replace the prefix with `node ./bin/loopctl.js` (and use `node ./bin/loopd.js` for `loopd`).

```bash
RUNTIME="github:sheepxux/SuperLoop#v2.0.0"

# Check the Skill, schemas, plugin metadata, and generated-file drift
npm exec --yes --package="$RUNTIME" -- loopctl doctor
npm exec --yes --package="$RUNTIME" -- loopctl skill validate

# First have the $superloop Skill write proposal.yaml; a proposal cannot execute
npm exec --yes --package="$RUNTIME" -- loopctl proposal validate proposal.yaml

# First resolve blockers; a human confirms assumptions and prerequisites, and readiness is ready-for-review
# Only a human who reviewed the complete proposal creates the digest-bound approval
npm exec --yes --package="$RUNTIME" -- loopctl proposal decide proposal.yaml \
  --approve --actor "your-name" --reason "goal and boundaries reviewed" \
  --out proposal-decision.json

# Compilation checks the approval digest and writes provenance; any tampering is rejected
npm exec --yes --package="$RUNTIME" -- loopctl proposal compile proposal.yaml \
  --decision proposal-decision.json --out loop.yaml

# Initialize from the approved contract; the name must exactly match loop.yaml metadata.name
LOOP_NAME="<loop.yaml metadata.name>"
npm exec --yes --package="$RUNTIME" -- loopctl init "$LOOP_NAME" \
  --from loop.yaml --out .superloop/loops

# Mechanically check budgets, retries, and human gates
npm exec --yes --package="$RUNTIME" -- loopctl next ".superloop/loops/$LOOP_NAME"

# Render platform-specific instance Skills
npm exec --yes --package="$RUNTIME" -- loopctl render codex ".superloop/loops/$LOOP_NAME/loop.yaml" --out .
npm exec --yes --package="$RUNTIME" -- loopctl render claude-code ".superloop/loops/$LOOP_NAME/loop.yaml" --out .

# Exercise the Runner safely; this does not count as task success or evolution evidence
npm exec --yes --package="$RUNTIME" -- loopd start --once --loop "$LOOP_NAME"
```

Codex instances are written to `.agents/skills/<loop-name>/`; Claude Code instances go to `.claude/skills/<loop-name>/`. They are loop-specific execution entry points and never overwrite the canonical `superloop` Skill.

The bundled `skills/superloop/assets/proposal.yaml` is **intentionally `needs-input`**: its assumption is unconfirmed and its repository-access prerequisite is unmet, so it cannot be approved as shipped. A human must review and confirm or reject every assumption, verify each prerequisite's real status, and then make readiness and blockers reflect reality. Only an unblocked `ready-for-review` proposal can be approved.

When a human requests changes, create a digest-linked revision instead of overwriting the old proposal. Revision 2 and later must supply the exact parent proposal during validation, decision, and compilation:

```bash
loopctl proposal revise proposal-v1.yaml --out proposal-v2.yaml
# Edit proposal-v2.yaml, resolve the request, and have a human confirm assumptions and prerequisites
loopctl proposal validate proposal-v2.yaml --parent proposal-v1.yaml
loopctl proposal decide proposal-v2.yaml --parent proposal-v1.yaml \
  --approve --actor "your-name" --reason "revision and prerequisites reviewed" \
  --out proposal-v2-decision.json
loopctl proposal compile proposal-v2.yaml --parent proposal-v1.yaml \
  --decision proposal-v2-decision.json --out loop.yaml
```

For a proposal-compiled contract, `init` does not rename the reviewed contract or relocate its persistence paths: `<name>` must exactly equal `loop.yaml.metadata.name`, `--out` must be `.superloop/loops`, and the result uses `.superloop/loops/<name>/{state.json,runs/,inbox.md,decisions.md}`. Revise and re-approve the proposal to change a name or path.

Direct `loop.yaml` authoring is only for a user-supplied existing contract or an explicitly requested expert path. An agent must not move a vague or new idea onto it to bypass Proposal review.

## Migrate from Loop-Engineering v1.1.0 to SuperLoop v2

Stop the legacy Runner and make a complete backup of `.loop-engineering/loops/<name>`. When the old contract contains `metadata.provenance`, create a parent-linked revision from the original proposal, change the candidate contract to `apiVersion: superloop/v2`, update persistence paths to `.superloop/loops/<name>/...`, then validate, obtain fresh human approval, and compile again:

```bash
loopctl proposal validate proposal-v2.yaml --parent proposal-v1.yaml
loopctl proposal decide proposal-v2.yaml --parent proposal-v1.yaml \
  --approve --actor "your-name" --reason "SuperLoop v2 identity and persistence migration reviewed" \
  --out proposal-v2-decision.json
loopctl proposal compile proposal-v2.yaml --parent proposal-v1.yaml \
  --decision proposal-v2-decision.json --out loop-v2.yaml
loopctl init "<exact metadata.name>" --from loop-v2.yaml --out .superloop/loops
```

Keep the old `.loop-engineering` directory as immutable audit evidence. v2 creates a new generation, contract digest, state, and run ledger; prior Part/Goal passes, pending experiments, and approvals do not automatically become v2 success evidence. A directly authored v1 contract without its original proposal/decision must be explicitly rewritten and reviewed by a human rather than having the runtime infer authority.

## Upgrade from v1.0.1 to v1.0.2 (historical)

Stop `loopd`, confirm that the loop is not executing work, and back up the loop directory. Then migrate each existing loop with the `v1.0.2` runtime:

```bash
RUNTIME="github:sheepxux/SuperLoop#v1.0.2"
LOOP_DIR=".loop-engineering/loops/<name>"

npm exec --yes --package="$RUNTIME" -- loopctl migrate "$LOOP_DIR"
npm exec --yes --package="$RUNTIME" -- loopctl validate "$LOOP_DIR/loop.yaml"
npm exec --yes --package="$RUNTIME" -- loopctl next "$LOOP_DIR"
```

`migrate` adds a loop-generation identifier and the exact `loop.yaml` SHA-256 binding to durable state, then anchors the complete continuous strategy parent chain from `v1` through the active version. Repeating it on an already migrated, consistent loop is a verified idempotent no-op. A contract mismatch, strategy-version mismatch, missing/extra/broken archive chain, or unverifiable state makes migration fail closed. Do not bypass these checks by editing `state.json`.

For an expired lease, migration can preserve it as a digest-named retired audit file when a same-host PID is confirmed dead. If the owner is remote or process death cannot be proven, the operator must verify it first and then explicitly pass `--retire-expired-lease`. The flag never bypasses rejection of an unexpired lease, a live same-host PID, or a malformed lease.

Migration does not translate old experiments or approvals into new evidence. An old pending experiment is marked `invalidated` in history and released; rebuild and restage it in the `v1.0.2` per-case evaluator/attestation format under a **new experiment ID**, and never reuse the old approval. Migration preserves a due trigger for this one rebuild. Afterward, a new experiment can be staged only when `evolution.trigger.afterRuns` or `evolution.trigger.consecutiveFailures` reaches its configured threshold, and a loop may have only one pending experiment at a time.

## Controlled Strategy Evolution

```text
real run → independent evaluation → metric observation → frozen benchmark
         → same-case baseline/candidate comparison → mechanical scoring → reject/review/promote
                                                                  ↓
                                                            archive and rollback
```

A credible experiment requires:

- an immutable benchmark manifest and SHA-256;
- identical case IDs for baseline and candidate, with each arm bound to its strategy SHA-256;
- per-case score, verdict, artifact, SHA-256, evaluator identity, independent context, arm, and corresponding strategy SHA-256;
- per-case command evidence plus a strategy-evaluator attestation bound to the complete benchmark and evidence;
- minimum sample and improvement thresholds;
- digest-bound human approval for medium- or high-risk loops.

```bash
loopctl evolve <loop-dir> --experiment experiment.json

# After pending-review, a human creates approval bound to the current experiment digest
loopctl approval create <loop-dir> \
  --experiment experiment.json \
  --approver "name" \
  --reason "matched evidence passed review" \
  --out approval.json

loopctl evolve <loop-dir> \
  --experiment experiment.json \
  --approval approval.json

# Or let an independent human reject the exact pending experiment; the decision is immutable
loopctl experiment reject <loop-dir> \
  --experiment experiment.json \
  --actor "name" \
  --reason "evidence is insufficient"

# Only when no experiment is pending, restore v1 behavior as a new version
loopctl strategy rollback <loop-dir> \
  --to 1 \
  --actor "name" \
  --reason "post-promotion regression"
```

A candidate may change only `strategy.json.instructions`. It cannot modify `loop.yaml`, permissions, discovery bounds, budgets, verification commands, evidence requirements, or human gates.

Rejecting a pending experiment writes its exact digest, independent actor, time, and reason to an immutable decision artifact and marks the history outcome `abandoned`. This consumes the current experiment trigger window. A new experiment ID becomes eligible only after new attributable runs with task results reach the configured threshold; `dry-run`, `no-work`, and `budget-exceeded` do not increment experiment-trigger counters.

## Core Commands

```bash
loopctl skill validate [dir]
loopctl skill install <codex|claude-code|both> --scope <project|user>
loopctl proposal validate <proposal.yaml...> [--parent <parent-proposal.yaml>]
loopctl proposal revise <parent-proposal.yaml> --out <proposal.yaml>
loopctl proposal decide <proposal.yaml> [--parent <parent-proposal.yaml>] --approve|--reject|--request-changes [--change <text>] --actor <human> --reason <text> --out <decision.json>
loopctl proposal compile <proposal.yaml> [--parent <parent-proposal.yaml>] --decision <decision.json> --out <loop.yaml>
loopctl validate <loop.yaml...>
loopctl init <name> --from <loop.yaml> --out <directory>
loopctl migrate <loop-dir|loop.yaml> [--retire-expired-lease]
loopctl render <adapter> <loop.yaml> --out <directory>
loopctl next <loop-dir|loop.yaml>
loopctl record <loop-dir> --run <run-log.json>
loopctl evolve <loop-dir> --experiment <experiment.json> [--approval <approval.json>]
loopctl approval create <loop-dir> --experiment <file> --approver <name> --reason <text> --out <file>
loopctl experiment reject <loop-dir> --experiment <file> --actor <human> --reason <text>
loopctl strategy rollback <loop-dir> --to <version> --actor <name> --reason <text>
loopctl status --root .superloop/loops
loopctl runs <loop-dir>
loopctl pause <loop-dir> --reason <text>
loopctl resume <loop-dir>
loopctl part reopen <loop-dir> --id <part-id> --actor <human> --reason <text>
loopctl goal resolve <loop-dir> --actor <human> --reason <text>
loopctl check <schema> <file...>
loopctl schema <schema>
loopctl doctor
```

Supported instance renderers:

- `codex`
- `claude-code`
- `chatgpt`
- `openclaw`
- `generic-harness`
- `github-actions-scaffold`

## Evidence and Safety Model

The worker produces a candidate result, an independent evaluator decides whether the result passes, and a human decides whether high-risk external effects occur. In a finite Work Plan, the intermediate evaluator checks only the active Part's exact criteria and declared artifacts; a separate final Goal Gate checks the complete Goal, so an intermediate Part is never asked to pretend it completed the whole outcome.

Run recording validates evaluator artifact schema, configured identity, loop/item/verdict/context bindings, real-path containment, and SHA-256. A passing finite Work Plan result must map every declared artifact to a distinct, run-versioned real snapshot inside the Loop directory whose bytes match the recomputed SHA-256. Accepted snapshots cannot be overwritten; corrections emit new snapshots from separate editable working files, and externally hosted deliverables need a durable local export or receipt. Passing results must cover the active Part's effective evidence/commands—its own envelope or the Loop default when omitted—while the final Goal Gate covers the complete global envelope. `passed + []`, status/verdict mismatches, duplicate or unknown items, terminal-state overwrites, discovery/budget overruns, missing state, time regression, and future timestamps are rejected. The Runner overwrites a command draft's `startedAt` and `finishedAt` with its trusted execution window and derives the UTC accounting day from completion; accounting cannot move backward. State-ledger timestamps must be monotonic, and `lastRunAt` must match the latest non-dry-run record. Transaction recovery mechanically recomputes target state and its accounting day from journal pre-state plus immutable artifacts instead of trusting a partial write. Run records are immutable; identical replay revalidates evaluator and Part-artifact evidence while remaining idempotent and cannot consume budget twice.

The current Runner is not an operating-system sandbox. A command executor uses the current user's permissions and runs only with explicit `--allow-command`; that flag does not authorize merge, deployment, deletion, spending, external messages, or permission changes. Do not give unattended loops privileged production credentials or enable commands in untrusted repositories.

## Repository Layout

```text
skills/superloop/   canonical Skill, references, assets, scripts, and evals
.codex-plugin/             Codex plugin manifest
.claude-plugin/            Claude Code plugin and marketplace manifests
.agents/plugins/           Codex marketplace manifest
protocol/                  protocol schemas
src/                       loopctl, Runner, evolution, and installation implementation
templates/                 compatibility mirror of canonical Skill assets
adapters/                  non-canonical platform guidance
examples/                  validated loop examples
test/                      runtime, evidence, safety, installation, and rendering tests
docs/                      architecture, protocol, positioning, and release documentation
```

## Current Boundaries

- “Universal” means the control protocol and Part model are domain-neutral, not that literally every task can complete automatically. Work must be boundedly decomposable, leave durable evidence, support independent evaluation, and have real worker, evaluator, tool, and credential integrations.
- `loopd` is a local reference runtime and does not embed Codex, Claude, or OpenClaw SDKs; real agents connect through the command executor or platform scheduling.
- GitHub Actions output is a manual, read-only preflight scaffold. Add a real executor, durable state channel, least-privilege permissions, and secret policy before scheduling it.
- Atomic file replacement, serialized state updates, lease-operation locks, owner tokens, and timeouts are implemented. State-lock acquire/reclaim shares an atomic gate to prevent ABA races; a process crash inside that gate fails closed until an operator confirms no owner is alive and clears it manually. This is not a distributed database or container sandbox.
- Runs, state, experiments, approvals, rejection decisions, promotions, and rollbacks use recoverable transaction journals. This is local-filesystem integrity, not a cross-host consensus protocol.
- Commands must remain in the foreground and leave no background children. The synchronous reference Runner has no in-flight async heartbeat or process-group sandbox.
- `approval.approver` and `decision.actor` are local audit assertions, not identity-provider authentication. The runtime rejects configured worker/evaluator self-approval or self-rejection, but high-risk governance still requires a real human process.
- Evaluator identity and context IDs are auditable protocol bindings, not cryptographic identity or process-isolation proofs. The integration platform or executor must create genuinely independent contexts.
- A finite Work Plan stays fixed while it runs. Changing Part scope, order, dependencies, artifacts, acceptance, or the final Goal Gate requires stopping and creating a parent-linked proposal revision; the plan cannot silently expand itself.
- `blocked` and `needs-human` are never converted back to executable work by a generic `resume`. Part and final-Goal recovery use `part reopen` and `goal resolve`, with an independent actor, reason, and immutable binding to the attention run.
- Strategy evolution provides verifiable external strategy optimization. It does not guarantee every candidate improves and does not claim autonomous model training.

## Development and Release Validation

```bash
npm ci
npm run build
npm run smoke
npm run package:smoke
npm pack --dry-run
npm publish --dry-run
gh skill publish --dry-run
```

`npm run build` regenerates static adapters from one source and mirrors the canonical Skill assets into `templates/`. `loopctl doctor` fails when either surface drifts. `package:smoke` installs a real tarball and both platform Skills in an empty project, then proves a stale runtime cannot bypass the exact-version helper fallback. Fresh-session summaries and digest-bound reviewer-authored expectation records live under `skills/superloop/evals/`. Raw model transcripts, model identifiers, and provider attestations were not retained, so this is not presented as a reproducible provider evaluation.

More documentation:

- [Positioning](docs/positioning.md)
- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Runner](docs/runner-design.md)
- [Adapters](docs/adapters.md)
- [Publish checklist](docs/publish-checklist.md)
- [Roadmap](docs/roadmap.md)

## License

MIT
