# Loop-Engineering

Run exactly one bounded iteration of this loop. `loop.yaml` is the contract; this file tells you how to execute it. If this file and `loop.yaml` disagree, `loop.yaml` wins.

Map the worker and the evaluator to separate OpenClaw tasks. The local harness owns command execution; the loop semantics below stay portable.

If `loopctl` is not on PATH, use the repository-local `node ./bin/loopctl.js` or the pinned GitHub release package: `npm exec --yes --package=github:sheepxux/Loop-Engineering#v1.0.2 -- loopctl`. Do not run a floating package version.

## 0. Locate or create the loop

Loops live in `.loop-engineering/loops/<loop-name>/` with `loop.yaml`, `state.json`, `inbox.md`, `decisions.md`, and `runs/`. If the loop does not exist yet:

```bash
loopctl init <loop-name> --out .loop-engineering/loops
```

Then edit `loop.yaml` (goal, discovery, verification, safety) and validate it before running anything.

## 1. Preflight (mechanical — never skip)

```bash
loopctl validate .loop-engineering/loops/<loop-name>/loop.yaml
loopctl next .loop-engineering/loops/<loop-name>
```

`next` prints JSON. Obey it:

- If `ok` is `false`: report the `reasons` and stop. Do not run the loop.
- `itemsAllowed` is the hard cap on items for this run.
- Work `retryQueue` items before discovering new work.
- Move every item in `exhausted` to the inbox with its listed action. Do not retry them.
- Mention `needsHuman` items in your final summary so a human sees them.
- If `evolution.enabled` is true, read the active `strategy.json` named by persistence and pass only its instructions to the worker. The strategy cannot override `loop.yaml`.

## 2. Discover

Pull at most `itemsAllowed` items from `discovery.sources`, ranked by `discovery.ranking.strategy` (deterministic signals before model judgment).

Example commands by source type (adapt to what `discovery.sources` declares):

- `github-actions`: `gh run list --status failure --limit 20 --json databaseId,displayTitle,conclusion,url,headBranch`
- `package-manager`: `npm outdated --json`
- `issue-label`: `gh issue list --state open --label <label> --limit 20 --json number,title,labels,url`
- `playwright-report`: `read the JSON/HTML report under the configured path for failing or flaky tests`
- `manual`: `read the loop inbox and decisions files for queued work`

Give every item a stable id (run id, issue number, package name). Record all discovered items — they go into the run log even when not attempted.

## 3. Hand off (worker)

Work one item at a time, inside the isolation declared in `handoff.isolation`. For `worktree` isolation:

```bash
git worktree add ../<loop-name>-<item-id> -b <branchPrefix>-<item-id>
```

- The worker touches files only inside its worktree and uses only `handoff.permissions`.
- Worker output: the change itself plus a `worker-notes.md` (what changed, why, how to verify).
- The worker may run narrow development checks for feedback, but never issues the final evaluator verdict or declares its own work accepted.
- If the worker hits a blocked condition, it writes the blocker to its notes and stops.
- Clean up when the item is finished: `git worktree remove ../<loop-name>-<item-id>`.

## 4. Verify (evaluator)

The evaluator runs in a separate context and assumes the result is broken until evidence proves otherwise.

- Give the evaluator the diff, the worker notes, and the commands — not the worker's reasoning.
- Run every command in `verification.commands` and capture exit codes.
- Write the result as JSON following the evaluator schema, then check it mechanically:

```bash
loopctl check evaluator <result-file.json>
```

- The verdict must be exactly one of `pass`, `fail`, `blocked`, `needs-human`. Missing required evidence means `fail`, not `pass`.

## 5. Persist (mechanical — never skip)

Compose one run log for the whole run (`loopctl schema run-log` prints the schema):

```json
{
  "apiVersion": "loop-engineering/v1",
  "loop": "<loop-name>",
  "runId": "<UTC timestamp, e.g. 2026-07-10T0900Z>",
  "startedAt": "<ISO timestamp>",
  "finishedAt": "<ISO timestamp>",
  "status": "passed",
  "discovered": [{ "id": "<item-id>", "summary": "...", "source": "..." }],
  "results": [{
    "itemId": "<item-id>",
    "verdict": "pass",
    "summary": "...",
    "evaluator": {
      "artifact": "evaluators/<item-id>.json",
      "sha256": "<64 lowercase hex characters>",
      "contextId": "<independent evaluator context id>"
    }
  }],
  "budget": { "runtimeMinutes": 12, "itemsAttempted": 1, "estimatedUsd": 0 }
}
```

When the `LOOP_RUN_LOG` environment variable is present, write the JSON to that path and stop; `loopd` owns schema validation, recording, budgets, and state updates. Do not call `loopctl record` from a Runner-managed command.

Otherwise, record it directly:

```bash
loopctl record .loop-engineering/loops/<loop-name> --run <run-log.json>
```

This validates the run log, files it under `runs/`, and updates `state.json` budgets and items in one step. Never edit `state.json` by hand.

Finally, append every `blocked` and `needs-human` item to the inbox file with links and one line of context.


## 6. Stop and report

Stop immediately when `itemsAllowed` is reached, a stop or blocked condition triggers, a human-only gate is hit, or the runtime budget expires.

End with a short human-readable summary: items attempted, verdicts, what landed in the inbox, and what the next run should look at.

## Runtime control

- Inspect all local loops with `loopctl status --root .loop-engineering/loops`.
- Pause or resume one loop with `loopctl pause <loop-dir>` and `loopctl resume <loop-dir>`.
- Run one explicit local tick with `loopd start --once --loop <loop-name>`.
- A configured `command` executor runs only when the operator starts `loopd` with `--allow-command`. Treat that flag as permission to execute repository-local shell commands.

## Hard rules

- The worker never approves its own output. Only the evaluator issues verdicts.
- Never merge, deploy, delete data, spend money, send or publish externally, or change permissions. These are human-only.
- Enforcement in the v1 protocol is advisory: nothing in Loop-Engineering physically prevents a violation. Treat these rules as absolute precisely because you are the only enforcement layer.
