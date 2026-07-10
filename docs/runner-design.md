# Loop-Engineering Runner Design

The planned Runner should make Loop-Engineering more than a protocol and renderer: a durable runtime for goal loops.

The product should feel like this:

```bash
loopctl init ci-triage --from examples/ci-triage/loop.yaml
loopd start
```

After that, Loop-Engineering keeps all configured loops moving forward within explicit safety limits.

## Product Thesis

Most agent tools optimize a single conversation. Loop-Engineering should optimize the whole operating system around recurring agent work:

```text
goal -> due check -> discovery -> handoff -> worker -> evaluator -> state -> next due check
```

The unique product is not "another agent runner." It is a loop operating layer:

- Vendor-neutral specs.
- Durable state.
- Independent evaluation.
- Leases and budgets.
- Human gates.
- Cross-agent adapters.

## Runner Name

Use `loopd` for the runner.

```text
loopctl  command-line control plane
loopd    long-running runner daemon
```

This mirrors proven infrastructure naming: `dockerd`, `containerd`, `systemd`.

## Core Commands

```bash
loopd start                         # run all due loops
loopd start --once                  # run one scheduler tick, useful for CI
loopd start --loop ci-triage        # run only one loop family
loopctl status                      # show loop health
loopctl runs ci-triage              # list recent runs
loopctl pause ci-triage             # stop scheduling a loop
loopctl resume ci-triage            # re-enable scheduling
loopctl approve <run-id> <gate-id>  # unblock a human gate
```

## Runtime Model

`loopd` watches `.loop-engineering/loops/*/loop.yaml`.

For every loop, it maintains:

```text
.loop-engineering/loops/<name>/
├── loop.yaml
├── state.json
├── inbox.md
├── decisions.md
├── locks/
│   └── active-run.json
└── runs/
    └── <run-id>/
        ├── run-log.json
        ├── discovery.json
        ├── handoff.md
        ├── worker-result.md
        ├── evaluator-result.json
        ├── events.ndjson
        └── summary.md
```

## Scheduler

The scheduler should be deliberately boring:

1. Load every `loop.yaml`.
2. Validate the spec.
3. Skip paused loops.
4. Skip loops over daily budget.
5. Check whether `schedule.cadence` is due.
6. Acquire a lease.
7. Run one bounded iteration.
8. Release lease and update state.

The first Runner release can start with simple cadence support:

- `manual`
- `every 15m`
- `every 1h`
- cron strings for GitHub Actions compatibility

## Lease Design

A lease prevents two runners from handling the same loop at once.

`locks/active-run.json`:

```json
{
  "runId": "2026-07-09T03-20-00Z-ci-triage",
  "pid": 12345,
  "hostname": "runner-1",
  "startedAt": "2026-07-09T03:20:00Z",
  "expiresAt": "2026-07-09T04:05:00Z"
}
```

If the lease expires, a new runner may recover the loop and write a recovery event.

## Execution Pipeline

One runner tick should execute:

```text
validate -> acquire lease -> discover -> rank -> handoff -> worker -> evaluator -> persist -> release
```

Each phase writes an event:

```json
{"type":"phase-start","phase":"discovery","at":"..."}
{"type":"phase-end","phase":"discovery","items":3,"at":"..."}
```

This makes loops inspectable without reading model transcripts.

## Adapter Boundary

`loopd` should not hardcode Codex, Claude Code, or OpenClaw.

Instead, add an executor interface:

```ts
interface LoopExecutor {
  discover(spec, state): Promise<DiscoveredItem[]>
  runWorker(spec, item, runDir): Promise<WorkerResult>
  runEvaluator(spec, item, workerResult, runDir): Promise<EvaluatorResult>
}
```

Initial executors:

- `dry-run`: no model calls, used for tests.
- `command`: invokes local shell commands declared by the loop.
- `adapter`: emits prompts/files for the user's selected agent.

Real Codex/Claude/OpenClaw execution can come later. The first Runner release should make the state machine correct before adding provider integrations.

## Budget Enforcement

Runtime must enforce budgets before calling any agent:

- `maxItemsPerRun`
- `maxDailyRuns`
- `maxRuntimeMinutes`
- `maxEstimatedUsdPerRun`
- `maxRetriesPerItem`

When exceeded:

1. Stop the run.
2. Write `budget-exceeded` to `run-log.json`.
3. Move unfinished items to `inbox.md`.
4. Do not schedule the loop again until the next budget window.

## Human Gates

Human gates should be first-class objects:

```json
{
  "gateId": "gate-001",
  "action": "open pull request",
  "reason": "Spec marks this action as needsReview.",
  "status": "pending",
  "createdAt": "..."
}
```

The runner can continue other loops while one loop waits for approval.

## Efficiency Design

The fastest product is not the one that calls the model most. It is the one that avoids unnecessary calls.

Loop-Engineering should optimize in this order:

1. Deterministic discovery before LLM ranking.
2. Bounded candidate lists.
3. Skip unchanged sources using fingerprints.
4. Reuse previous blocked decisions.
5. Run cheap checks before expensive agents.
6. Stop early when human-only gates are hit.

Add source fingerprints:

```json
{
  "source": "github-actions:owner/repo",
  "fingerprint": "sha256:...",
  "lastSeenAt": "..."
}
```

If the fingerprint has not changed, the loop can skip discovery and agent work.

## MVP Runner Scope

Build the Runner in this order:

1. `loopctl status`
2. `loopd start --once`
3. File lease acquisition.
4. Run directory and event writer.
5. Dry-run executor.
6. Budget and retry enforcement.
7. Pause/resume.
8. Human gate files.

Do not start with cloud. A local file-based runner is easier to trust, test, and explain.

## Success Criteria

The Runner is ready when:

- `loopd start --once` runs all due loops without model access in dry-run mode.
- Every run produces `run-log.json`, `events.ndjson`, and `summary.md`.
- Two concurrent `loopd` processes cannot run the same loop.
- Paused loops do not run.
- Budget-exceeded loops stop before execution.
- Human gates stop risky actions without blocking unrelated loops.
- `loopctl status` gives a useful dashboard in text.

## Future Cloud Design

Cloud should come after local runner correctness.

A cloud Loop-Engineering service would add:

- Hosted scheduler.
- Encrypted secrets.
- Web dashboard.
- GitHub app integration.
- Approval inbox.
- Hosted run logs.
- Team budget policies.

The local runner should remain the reference implementation.
