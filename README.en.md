<p align="center">
  <img src="docs/assets/cover.png" alt="Loop-Engineering" width="720">
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

# Loop-Engineering

An installable advanced Agent Skill with a local reference runtime that supports it.

Loop-Engineering governs recurring agent work with an explicit, auditable engineering contract:

```text
suitability → goal → discovery → isolated handoff → independent verification → persistence → schedule → next run
                                                       ↓
                                         matched benchmark → promote or roll back strategy
```

Its primary product is the complete Skill under `skills/loop-engineering`. `loopctl`, `loopd`, protocol schemas, and platform plugins are the deterministic execution foundation for that Skill.

## Current Version: v1.0.2

`v1.0.2` is the release-hardened complete Skill-first v1. In addition to the canonical Skill, progressive references, self-contained assets, dual-platform plugins, local Runner, and controlled strategy evolution, it adds recoverable multi-file transactions, fail-closed lease/state recovery, immutable run records, a trusted dry-run boundary, real-path containment, per-case strategy-evaluator binding, and fresh-session summaries with digest-bound per-expectation review records.

“Evolution” means benchmark-gated task-strategy optimization. It does not modify model weights and cannot weaken the safety contract.

## What the Skill Does

The Skill first classifies a request:

- `one-shot`: do it directly; do not create a loop.
- `deterministic`: prefer a script, CI job, or cron entry.
- `agentic-loop`: design a loop for recurring work that needs bounded judgment.
- `unsafe-loop`: add human gates or refuse unattended execution.

For suitable work, it routes among seven modes: assess, design, scaffold, run, review, recover, and evolve.

## Complete v1.0 Capabilities

- Standard Agent Skills layout: `SKILL.md`, `agents/openai.yaml`, `references/`, `scripts/`, `assets/`, and `evals/`.
- One canonical Skill for Codex and Claude Code, avoiding duplicated instruction sources.
- Codex and Claude Code plugin/marketplace manifests plus source and npm installation fallbacks.
- Portable `loop.yaml` contract with JSON Schema and custom safety validation.
- Durable state, run planning, pause/resume, retry queues, a bounded ledger for the latest 1,000 runs, human inboxes, and audit logs.
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

## Install the Skill

### GitHub Skill (recommended; GitHub CLI currently marks this capability as preview)

```bash
gh skill install sheepxux/Loop-Engineering loop-engineering@v1.0.2 --agent codex
gh skill install sheepxux/Loop-Engineering loop-engineering@v1.0.2 --agent claude-code
```

### Codex plugin

```text
codex plugin marketplace add sheepxux/Loop-Engineering --ref v1.0.2
codex plugin add loop-engineering@loop-engineering
```

### Claude Code plugin

```text
claude plugin marketplace add sheepxux/Loop-Engineering@v1.0.2
claude plugin install loop-engineering@loop-engineering
```

### Install and validate from source

```bash
git clone --branch v1.0.2 https://github.com/sheepxux/Loop-Engineering.git
cd Loop-Engineering
npm ci
node ./bin/loopctl.js skill validate

# Project scope; use --scope user for a user-level installation
node ./bin/loopctl.js skill install both --scope project
```

After the publisher completes the optional npm registry release, you can also use:

```bash
npm install --global @sheepxux/loop-engineering@1.0.2
loopctl skill install both --scope user
```

## Quick Start

These commands use the pinned GitHub `v1.0.2` runtime directly, so plugin installation does not need to place `loopctl` on `PATH`. In a source checkout, replace the prefix with `node ./bin/loopctl.js` (and use `node ./bin/loopd.js` for `loopd`).

```bash
RUNTIME="github:sheepxux/Loop-Engineering#v1.0.2"

# Check the Skill, schemas, plugin metadata, and generated-file drift
npm exec --yes --package="$RUNTIME" -- loopctl doctor
npm exec --yes --package="$RUNTIME" -- loopctl skill validate

# Initialize a loop from the Skill's safe dry-run template
npm exec --yes --package="$RUNTIME" -- loopctl init quickstart --out .loop-engineering/loops

# Mechanically check budgets, retries, and human gates
npm exec --yes --package="$RUNTIME" -- loopctl next .loop-engineering/loops/quickstart

# Render platform-specific instance Skills
npm exec --yes --package="$RUNTIME" -- loopctl render codex .loop-engineering/loops/quickstart/loop.yaml --out .
npm exec --yes --package="$RUNTIME" -- loopctl render claude-code .loop-engineering/loops/quickstart/loop.yaml --out .

# Exercise the Runner safely; this does not count as task success or evolution evidence
npm exec --yes --package="$RUNTIME" -- loopd start --once --loop quickstart
```

Codex instances are written to `.agents/skills/<loop-name>/`; Claude Code instances go to `.claude/skills/<loop-name>/`. They are loop-specific execution entry points and never overwrite the canonical `loop-engineering` Skill.

## Upgrade from v1.0.1

Stop `loopd`, confirm that the loop is not executing work, and back up the loop directory. Then migrate each existing loop with the `v1.0.2` runtime:

```bash
RUNTIME="github:sheepxux/Loop-Engineering#v1.0.2"
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
loopctl status --root .loop-engineering/loops
loopctl runs <loop-dir>
loopctl pause <loop-dir> --reason <text>
loopctl resume <loop-dir>
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

The worker produces a candidate result, an independent evaluator decides whether the result passes, and a human decides whether high-risk external effects occur.

Run recording validates evaluator artifact schema, configured identity, loop/item/verdict/context bindings, real-path containment, and SHA-256. Passing results must cover configured evidence types and unique successful commands. `passed + []`, status/verdict mismatches, duplicate or unknown items, terminal-state overwrites, discovery/budget overruns, missing state, time regression, and future timestamps are rejected. The Runner overwrites a command draft's `startedAt` and `finishedAt` with its trusted execution window and derives the UTC accounting day from completion; accounting cannot move backward. State-ledger timestamps must be monotonic, and `lastRunAt` must match the latest non-dry-run record. Transaction recovery mechanically recomputes target state and its accounting day from journal pre-state plus immutable artifacts instead of trusting a partial write. Run records are immutable; identical replay revalidates evaluator evidence while remaining idempotent and cannot consume budget twice.

The current Runner is not an operating-system sandbox. A command executor uses the current user's permissions and runs only with explicit `--allow-command`; that flag does not authorize merge, deployment, deletion, spending, external messages, or permission changes. Do not give unattended loops privileged production credentials or enable commands in untrusted repositories.

## Repository Layout

```text
skills/loop-engineering/   canonical Skill, references, assets, scripts, and evals
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

- `loopd` is a local reference runtime and does not embed Codex, Claude, or OpenClaw SDKs; real agents connect through the command executor or platform scheduling.
- GitHub Actions output is a manual, read-only preflight scaffold. Add a real executor, durable state channel, least-privilege permissions, and secret policy before scheduling it.
- Atomic file replacement, serialized state updates, lease-operation locks, owner tokens, and timeouts are implemented, but this is not a distributed database or container sandbox.
- Runs, state, experiments, approvals, rejection decisions, promotions, and rollbacks use recoverable transaction journals. This is local-filesystem integrity, not a cross-host consensus protocol.
- Commands must remain in the foreground and leave no background children. The synchronous reference Runner has no in-flight async heartbeat or process-group sandbox.
- `approval.approver` and `decision.actor` are local audit assertions, not identity-provider authentication. The runtime rejects configured worker/evaluator self-approval or self-rejection, but high-risk governance still requires a real human process.
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

`npm run build` regenerates static adapters from one source and mirrors the canonical Skill assets into `templates/`. `loopctl doctor` fails when either surface drifts. `package:smoke` installs a real tarball and both platform Skills in an empty project, then proves a stale runtime cannot bypass the exact-version helper fallback. Fresh-session summaries and digest-bound reviewer-authored expectation records live under `skills/loop-engineering/evals/`. Raw model transcripts, model identifiers, and provider attestations were not retained, so this is not presented as a reproducible provider evaluation.

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
