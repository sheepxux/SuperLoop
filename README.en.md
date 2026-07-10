<p align="center">
  <img src="docs/assets/cover.png" alt="Loop-Engineering" width="720">
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

# Loop-Engineering

A portable loop-engineering protocol and toolset for AI coding agents.

Loop-Engineering turns recurring agent work into an explicit, reviewable loop:

```text
goal -> discovery -> handoff -> verification -> persistence -> schedule -> next run
```

The project is vendor-neutral. Codex, Claude Code, ChatGPT, OpenClaw, and custom execution harnesses are thin adapters over the same loop contract.

## Current Version: v0.3.0

`v0.3.0` adds the first usable local Runner. `loopd` scans loops, checks whether they are due, acquires atomic leases, runs dry-run or command executors, enforces timeouts, records events and results, and supports status, pause, and resume controls. The public API is still early and not yet guaranteed stable.

The `apiVersion: loop-engineering/v1` field identifies the protocol format. It does not mean the product has reached v1.0.0.

## Why It Exists

Loop engineering replaces turn-by-turn prompting with a designed operating loop: discover work, hand it off, verify it independently, persist state, and schedule the next run. The loop sits above prompts, context, and execution harnesses.

Many agent loops still live in prose instructions and personal scripts. That may be enough for one person and one run, but recurring or unattended work needs a stronger contract:

- What goal is the loop advancing?
- How does it discover bounded work?
- Who performs the work?
- Who verifies it independently?
- Where does state live after the conversation ends?
- Which budgets, retry caps, and human gates prevent unsafe automation?

Loop-Engineering makes those answers explicit in `loop.yaml`.

## What v0.3.0 Implements

- A portable `loop.yaml` protocol.
- JSON Schema validation plus additional safety checks.
- Initialization of durable loop directories and state.
- Mechanical run planning: `loopctl next` reads state and budgets and decides whether a run is allowed.
- Mechanical recording: `loopctl record` validates run logs, archives them, and updates state.
- A separate versioned `strategy.json`, so evolving task instructions never overwrite the immutable safety contract.
- Metric-triggered strategy experiments based on run counts or consecutive failures.
- `loopctl evolve`, which checks metric identity, sample counts, evidence commands, and minimum improvement before promotion.
- Human-reviewed strategy promotion by default for medium-risk loops.
- `loopd start --once` for one local scheduler tick, plus continuous polling.
- Atomic file leases that prevent two Runner processes from executing the same loop and recover expired leases.
- Per-run plans, event streams, run logs, stdout/stderr, and summaries.
- `loopctl status`, `runs`, `pause`, and `resume` for local operations.
- Adapters for Codex, Claude Code, ChatGPT, OpenClaw, generic harnesses, and GitHub Actions.

## Runner MVP

`loopd` supports explicit manual runs and local interval cadences such as `every 15m`, `every 1h`, and `every 1d`. GitHub Actions, Codex Automation, and cloud schedulers remain external scheduling surfaces.

The Runner does not yet embed the Codex, Claude, or OpenClaw SDKs. Its `command` executor passes the loop directory, plan, active strategy, run ID, and run-log destination to any external agent or script. The external program writes a draft; the Runner owns final validation, accounting, and persistence.

## Quick Start

```bash
npm install
node ./bin/loopctl.js validate examples/ci-triage/loop.yaml
node ./bin/loopctl.js doctor
node ./bin/loopctl.js init ci-triage \
  --from examples/ci-triage/loop.yaml \
  --out .loop-engineering/loops
node ./bin/loopctl.js render codex \
  examples/ci-triage/loop.yaml \
  --out /tmp/ci-triage-codex

# Before a run: is execution allowed, and how much work may it process?
node ./bin/loopctl.js next .loop-engineering/loops/ci-triage

# After a run: validate, archive, and update durable state.
node ./bin/loopctl.js record \
  .loop-engineering/loops/ci-triage \
  --run run-log.json

# Initialize a strategy-evolving development loop.
node ./bin/loopctl.js init self-improving-development \
  --from examples/self-improving-development/loop.yaml \
  --out .loop-engineering/loops

# Run one safe dry-run tick.
node ./bin/loopd.js start --once \
  --root .loop-engineering/loops \
  --loop self-improving-development
```

Command executors are disabled by default. Enable them only after you trust the local command declared in `loop.yaml`:

```bash
loopd start --once --loop <loop-name> --allow-command
```

## Controlled Strategy Evolution

Loop-Engineering evolves the external **task strategy**, not model weights and not the safety contract:

```text
task run -> record metric -> trigger experiment -> matched benchmark
         -> independent evaluation -> promote or reject
```

The active strategy lives in `strategy.json`. Candidates may replace only its `instructions`; they cannot change permissions, budgets, verification commands, evidence requirements, or human gates. Each experiment must provide the same metric, enough baseline and candidate samples, and successful evidence for every configured command. In `human-review` mode, the agent may stage a passing candidate but may not approve its own strategy.

## Core Contract

A valid loop defines:

- `goal`: objective, acceptance criteria, stop conditions, and blocked conditions.
- `discovery`: bounded sources and ranking policy.
- `handoff`: isolated worker contract.
- `verification`: independent evaluator and required evidence.
- `persistence`: state, run-log, inbox, and decision paths outside chat.
- `schedule`: runtime, cadence, timezone, timeout, and concurrency.
- `runner` (optional): local executor, working directory, command, and poll interval.
- `safety`: budgets, retries, failure policy, and human gates.
- `evolution` (optional): experiment triggers, primary metric, sample floor, improvement threshold, independent evaluator, and promotion mode.

The validator rejects specifications that omit required independent verification, persistence, budgets, or human-only gates for high-risk actions.

## Commands

```bash
loopctl validate <loop.yaml...>
loopctl init <loop-name> --from <loop.yaml> --out .loop-engineering/loops
loopctl render <adapter> <loop.yaml> --out <directory>
loopctl next <loop-dir|loop.yaml>
loopctl record <loop-dir> --run <run-log.json>
loopctl evolve <loop-dir> --experiment <experiment.json>
loopctl status --root .loop-engineering/loops
loopctl runs <loop-dir>
loopctl pause <loop-dir> --reason "maintenance"
loopctl resume <loop-dir>
loopctl check <loop|state|evaluator|run-log|strategy|experiment> <file...>
loopctl schema <loop|state|evaluator|run-log|strategy|experiment>
loopctl doctor
```

`next` reports daily budget state, the current item cap, retry queue, exhausted items, human-review items, stop conditions, and whether strategy evolution is due. It exits non-zero when the loop must not run.

`record` validates the run log against the protocol, rejects runs above `maxItemsPerRun`, builds the next state, validates it, then writes both the run record and `state.json`.

## Adapters

v0.3.0 supports:

- `codex`
- `claude-code`
- `chatgpt`
- `openclaw`
- `generic-harness`
- `github-actions`

## Repository Layout

```text
protocol/       JSON Schemas for loop contracts and durable artifacts
src/            loopctl and loopd implementation
templates/      Reusable loop, state, strategy, and experiment templates
adapters/       Thin agent adapter templates
examples/       Validated example loops
test/           Runtime, validation, rendering, and Runner tests
docs/           Design and protocol documentation
```

## Security Model

The generator decides what may be produced; the evaluator decides what may not pass.

Task results and strategy candidates use separate independent evaluators. Merge, deploy, production-data deletion, spending, and permission changes require human-only gates.

The validator, budgets, state schemas, cadence checks, file leases, and command timeouts are mechanically enforced. Agent permissions and human gates are still execution contracts rather than an operating-system sandbox. The `command` executor runs with the current user's privileges, so `loopd` requires explicit `--allow-command` opt-in. Never enable it for an untrusted repository, and do not give unattended loops high-risk credentials.

## Example

```yaml
apiVersion: loop-engineering/v1
kind: Loop
metadata:
  name: ci-triage
goal:
  objective: "Discover recurring CI failures, draft fixes, and verify them independently before PR review."
verification:
  evaluator: ci-fix-evaluator
  independent: true
  defaultStance: assume-broken
```

See [examples/ci-triage/loop.yaml](examples/ci-triage/loop.yaml) for the complete specification and [examples/self-improving-development/loop.yaml](examples/self-improving-development/loop.yaml) for strategy evolution.

## Development

```bash
npm install
npm run smoke
npm pack --dry-run
```

All executor Skill content is generated from `src/skill-content.js`. After editing it, run `npm run build:adapters`; `loopctl doctor` fails if the checked-in adapters drift from the source.

More documentation:

- [Positioning](docs/positioning.md)
- [Protocol](docs/protocol.md)
- [Adapters](docs/adapters.md)
- [Runner](docs/runner-design.md)
- [Architecture](docs/architecture.md)
- [v0.1.0 Goals](docs/v0.1-goals.md)
- [Publish Checklist](docs/publish-checklist.md)
- [Roadmap](docs/roadmap.md)
