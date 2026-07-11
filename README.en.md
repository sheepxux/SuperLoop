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

## Current Version: v1.0.1

`v1.0.1` is the current patch release of the complete Skill-first v1. It provides one canonical Skill shared by Codex and Claude Code, progressively loaded references, self-contained templates, a real behavior-evaluation suite, dual-platform plugin manifests, an evidence-bound local Runner, and controlled task-strategy evolution; it also fixes strict-manifest loading compatibility for the Claude Code marketplace.

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
- Durable state, run planning, pause/resume, retry queues, human inboxes, and audit logs.
- Every task result must bind an independent evaluator artifact, context ID, and SHA-256; empty results cannot masquerade as success.
- Item, per-run time, daily run, and per-run cost budgets fail closed when exceeded.
- `dry-run` is observational: it does not count toward task success, budgets, or strategy metrics.
- Local `loopd` Runner with leases, timeouts, event streams, and isolated run directories.
- Fixed benchmark manifests, matched case IDs, per-case results, and evidence digests for strategy experiments.
- Aggregate scores are mechanically recomputed from case results instead of trusting reported totals.
- Human approval is bound to the exact staged experiment SHA-256; replacing a candidate invalidates approval.
- Every strategy version is archived; rollback restores prior behavior as a new monotonic version without rewriting history.
- Per-loop Codex/Claude Skills, ChatGPT advisory instructions, and OpenClaw/generic harness adapters.
- GitHub Actions generates an explicitly labeled read-only preflight scaffold, not a fake operational executor.

## Install the Skill

### GitHub Skill (recommended; GitHub CLI currently marks this capability as preview)

```bash
gh skill install sheepxux/Loop-Engineering loop-engineering@v1.0.1 --agent codex
gh skill install sheepxux/Loop-Engineering loop-engineering@v1.0.1 --agent claude-code
```

### Codex plugin

```text
codex plugin marketplace add sheepxux/Loop-Engineering --ref v1.0.1
codex plugin add loop-engineering@loop-engineering
```

### Claude Code plugin

```text
claude plugin marketplace add sheepxux/Loop-Engineering
claude plugin install loop-engineering@loop-engineering
```

### Install and validate from source

```bash
git clone --branch v1.0.1 https://github.com/sheepxux/Loop-Engineering.git
cd Loop-Engineering
npm ci
node ./bin/loopctl.js skill validate

# Project scope; use --scope user for a user-level installation
node ./bin/loopctl.js skill install both --scope project
```

After the publisher completes the optional npm registry release, you can also use:

```bash
npm install --global @sheepxux/loop-engineering@1.0.1
loopctl skill install both --scope user
```

## Quick Start

```bash
# Check the Skill, schemas, plugin metadata, and generated-file drift
loopctl doctor
loopctl skill validate

# Initialize a loop from the Skill's safe dry-run template
loopctl init quickstart --out .loop-engineering/loops

# Mechanically check budgets, retries, and human gates
loopctl next .loop-engineering/loops/quickstart

# Render platform-specific instance Skills
loopctl render codex .loop-engineering/loops/quickstart/loop.yaml --out .
loopctl render claude-code .loop-engineering/loops/quickstart/loop.yaml --out .

# Exercise the Runner safely; this does not count as task success or evolution evidence
loopd start --once --loop quickstart
```

Codex instances are written to `.agents/skills/<loop-name>/`; Claude Code instances go to `.claude/skills/<loop-name>/`. They are loop-specific execution entry points and never overwrite the canonical `loop-engineering` Skill.

## Controlled Strategy Evolution

```text
real run → independent evaluation → metric observation → frozen benchmark
         → same-case baseline/candidate comparison → mechanical scoring → reject/review/promote
                                                                  ↓
                                                            archive and rollback
```

A credible experiment requires:

- an immutable benchmark manifest and SHA-256;
- identical case IDs for baseline and candidate;
- per-case score, verdict, artifact, and SHA-256;
- command evidence from an independent strategy evaluator;
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

# If later evidence regresses, restore v1 behavior as a new version
loopctl strategy rollback <loop-dir> \
  --to 1 \
  --actor "name" \
  --reason "post-promotion regression"
```

A candidate may change only `strategy.json.instructions`. It cannot modify `loop.yaml`, permissions, discovery bounds, budgets, verification commands, evidence requirements, or human gates.

## Core Commands

```bash
loopctl skill validate [dir]
loopctl skill install <codex|claude-code|both> --scope <project|user>
loopctl validate <loop.yaml...>
loopctl init <name> --from <loop.yaml> --out <directory>
loopctl render <adapter> <loop.yaml> --out <directory>
loopctl next <loop-dir|loop.yaml>
loopctl record <loop-dir> --run <run-log.json>
loopctl evolve <loop-dir> --experiment <experiment.json> [--approval <approval.json>]
loopctl approval create <loop-dir> --experiment <file> --approver <name> --reason <text> --out <file>
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

Run recording validates evaluator artifact schema, loop/item/verdict/context bindings, and SHA-256. Passing results must cover configured evidence types and successful commands. `passed + []`, status/verdict mismatches, duplicate or unknown items, budget overruns, and future timestamps are rejected.

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
- Atomic file replacement, lease tokens, and timeouts are implemented, but this is not a distributed database or container sandbox.
- Strategy evolution provides verifiable external strategy optimization. It does not guarantee every candidate improves and does not claim autonomous model training.

## Development and Release Validation

```bash
npm ci
npm run build
npm run smoke
npm pack --dry-run
npm publish --dry-run
gh skill publish --dry-run
```

`npm run build` regenerates static adapters from one source and mirrors the canonical Skill assets into `templates/`. `loopctl doctor` fails when either surface drifts.

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
