# SuperLoop

Run exactly one bounded iteration of this loop. `loop.yaml` is the contract; this file tells you how to execute it. If this file and `loop.yaml` disagree, `loop.yaml` wins.




Map the worker and the evaluator to separate OpenClaw tasks. The local harness owns command execution; the loop semantics below stay portable.

If `loopctl` is not on PATH, use the repository-local `node ./bin/loopctl.js` or the pinned GitHub release package: `npm exec --yes --package=github:sheepxux/SuperLoop#v2.0.0 -- loopctl`. Do not run a floating package version.

## 0. Locate an approved loop

Loops live in `.superloop/loops/<loop-name>/` with `loop.yaml`, `state.json`, `inbox.md`, `decisions.md`, and `runs/`. If the loop does not exist, stop this executor workflow. Use the canonical `$superloop` Skill to create a non-executable `LoopProposal`, obtain a digest-bound human decision, and compile `loop.yaml` before initialization:

```bash
loopctl proposal validate proposal.yaml
loopctl proposal compile proposal.yaml --decision proposal-decision.json --out loop.yaml
loopctl init <loop-name> --from loop.yaml --out .superloop/loops
```

Never create or approve the proposal from this executor instance.

## 1. Preflight (mechanical — never skip)

```bash
loopctl validate .superloop/loops/<loop-name>/loop.yaml
loopctl next .superloop/loops/<loop-name>
```

`next` prints JSON. Obey it:

- If `ok` is `false`: report the `reasons` and stop. Do not run the loop.
- `itemsAllowed` is the hard cap on items for this run.
- Work `retryQueue` items before untouched eligible work.
- Move every item in `exhausted` to the inbox with its listed action. Do not retry them.
- Mention `needsHuman` items in your final summary so a human sees them.
- If `phase`, `eligibleParts`, and `lockedParts` are present, this is a finite Work Plan: obey the phase and exact Part digests instead of discovering new work.
- If `phase` is `goal-evaluation`, do not run a worker. If it is `completed`, stop.
- If `evolution.enabled` is true, read the active `strategy.json` named by persistence and pass only its instructions to the worker. The strategy cannot override `loop.yaml`.

## 2. Select eligible work

When `next` has no finite Work Plan phase, use continuous discovery:

Pull at most `itemsAllowed` items from `discovery.sources`, ranked by `discovery.ranking.strategy` (deterministic signals before model judgment).

Example commands by source type (adapt to what `discovery.sources` declares):

- `github-actions`: `gh run list --status failure --limit 20 --json databaseId,displayTitle,conclusion,url,headBranch`
- `package-manager`: `npm outdated --json`
- `issue-label`: `gh issue list --state open --label <label> --limit 20 --json number,title,labels,url`
- `playwright-report`: `read the JSON/HTML report under the configured path for failing or flaky tests`
- `manual`: `read the loop inbox and decisions files for queued work`

Give every item a stable id (run id, issue number, package name). Record all discovered items — they go into the run log even when not attempted.

When `next` reports a finite phase, do not discover anything: in `work`, select only returned `eligibleParts`; in `goal-evaluation`, skip the worker; in `completed`, stop.

## 3. Hand off (worker)

Work one selected item or eligible Part at a time. Use only the isolation declared in `handoff.isolation`:

- `worktree`: create one item-specific worktree from the configured branch prefix; remove it after evidence has been persisted.
- `branch`: use one caller-provided item-specific branch; never merge it from the worker context.
- `task-directory`: use one caller-provided isolated directory; keep edits and notes inside it.
- `thread`: use one caller-provided isolated context and persist outputs to approved artifact paths.
- `none`: perform only non-writing work; stop before any mutation.

- The worker stays inside the selected isolation boundary and uses only `handoff.permissions`.
- Worker output: the change itself plus a `worker-notes.md` (what changed, why, how to verify).
- The worker may run narrow development checks for feedback, but never issues the final evaluator verdict or declares its own work accepted.
- If the worker hits a blocked condition, it writes the blocker to its notes and stops.
- For a finite Work Plan, give the worker exactly one returned eligible Part, its digest, Part criteria, dependencies, and expected artifact IDs. Never run a worker in `goal-evaluation` or `completed`.

## 4. Verify the current phase

The evaluator runs in a separate context and assumes the result is broken until evidence proves otherwise.

- Give the evaluator the diff or artifact, worker notes, and commands — not the worker's reasoning.
- Run every command in `verification.commands` and capture exit codes.
- Write JSON matching the evaluator schema and run `loopctl check evaluator <result-file.json>`.
- The verdict must be `pass`, `fail`, `blocked`, or `needs-human`. Missing required evidence means `fail`.


For a finite Work Plan, use the phase-specific gate:

**Part Gate (`phase=work`)**

- Use a fresh `the configured Part evaluator` context.
- Evaluate only the exact active Part acceptance criteria, expected artifacts, global non-goals, blocked conditions, permissions, and safety policy. Do not fail an intermediate Part merely because the whole Goal is not complete.
- Bind `itemId` and `partDefinitionSha256` exactly to the selected `eligibleParts` entry.
- Include one passing `criteria` record for every exact Part criterion ID and the exact `artifacts` set declared by that Part; every artifact needs its ID, reference, and SHA-256.
- Run the active Part's `verification.commands` when declared; otherwise run the Loop-level `verification.commands`. Require the matching effective evidence, write evaluator JSON, and check it with `loopctl check evaluator <result-file.json>`.

**Final Goal Gate (`phase=goal-evaluation`)**

- Do not run a worker, discover items, or include Part results.
- Use a fresh `workPlan.completion.evaluator` context, independent from the worker and distinct from every Part-evaluation context.
- Bind `basisSha256` exactly to `goalEvaluationBasisSha256` from `loopctl next`.
- Record exactly one criterion result for every exact string in `goal.acceptanceCriteria`, require all configured completion evidence and commands, and name `affectedParts` on failure.
- Write JSON matching `loopctl schema goal-evaluation`, then run `loopctl check goal-evaluation <goal-evaluation.json>`.
- Only `verdict=pass` with `nextAction=complete` completes the Loop. Failure reopens the recorded affected Parts and descendants; `blocked` or `needs-human` stops.

If `phase=completed`, do not evaluate or record another run.

## 5. Persist (mechanical — never skip)

Compose one run log for the whole run (`loopctl schema run-log` prints the schema):

For continuous discovery:

```json
{
  "apiVersion": "superloop/v2",
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

For finite `phase=work`, `discovered` must be empty and the result binds the approved Part:

```json
{
  "apiVersion": "superloop/v2",
  "loop": "<loop-name>",
  "runId": "<UTC timestamp>",
  "startedAt": "<ISO timestamp>",
  "finishedAt": "<ISO timestamp>",
  "status": "passed",
  "discovered": [],
  "results": [{
    "itemId": "<eligible-part-id>",
    "partDefinitionSha256": "<digest from eligibleParts>",
    "verdict": "pass",
    "summary": "Part Gate passed.",
    "evaluator": {
      "artifact": "evaluators/<eligible-part-id>.json",
      "sha256": "<64 lowercase hex characters>",
      "contextId": "<independent Part evaluator context id>"
    },
    "artifacts": [{ "id": "<declared-artifact-id>", "reference": "<durable reference>", "sha256": "<artifact digest>" }]
  }],
  "budget": { "runtimeMinutes": 12, "itemsAttempted": 1, "estimatedUsd": 0 }
}
```

For `phase=goal-evaluation`, both `discovered` and `results` must be empty; bind the final evaluator artifact:

```json
{
  "apiVersion": "superloop/v2",
  "loop": "<loop-name>",
  "runId": "<UTC timestamp>",
  "startedAt": "<ISO timestamp>",
  "finishedAt": "<ISO timestamp>",
  "status": "passed",
  "discovered": [],
  "results": [],
  "goalEvaluation": {
    "verdict": "pass",
    "summary": "Every exact Goal criterion passed.",
    "basisSha256": "<goalEvaluationBasisSha256 from next>",
    "evaluator": {
      "artifact": "evaluators/goal-evaluation.json",
      "sha256": "<64 lowercase hex characters>",
      "contextId": "<independent Goal evaluator context id>"
    }
  },
  "budget": { "runtimeMinutes": 8, "itemsAttempted": 0, "estimatedUsd": 0 }
}
```

When the `LOOP_RUN_LOG` environment variable is present, write the JSON to that path and stop; `loopd` owns schema validation, recording, budgets, and state updates. Do not call `loopctl record` from a Runner-managed command.

Otherwise, record it directly:

```bash
loopctl record .superloop/loops/<loop-name> --run <run-log.json>
```

This validates the run log, files it under `runs/`, and updates `state.json` budgets and items in one step. Never edit `state.json` by hand.

Finally, append every `blocked` and `needs-human` item to the inbox file with links and one line of context.


## 6. Stop and report

Stop immediately when phase is `completed`, `itemsAllowed` is reached, a stop or blocked condition triggers, a human-only gate is hit, or the runtime budget expires.

End with a short human-readable summary: phase, items or Parts attempted, verdicts, eligible and locked Parts, Goal Gate outcome, what landed in the inbox, and what the next run should look at.

## Runtime control

- Inspect all local loops with `loopctl status --root .superloop/loops`.
- Pause or resume one loop with `loopctl pause <loop-dir>` and `loopctl resume <loop-dir>`.
- Run one explicit local tick with `loopd start --once --loop <loop-name>`.
- A configured `command` executor runs only when the operator starts `loopd` with `--allow-command`. Treat that flag as permission to execute repository-local shell commands.

## Hard rules

- The worker never approves its own output. Only the evaluator issues verdicts.
- One Loop owns the whole Goal. A Part is one bounded unit and an iteration is one attempt; never create a nested Loop for each Part.
- Never work a locked or out-of-plan Part, advance after a failed Part Gate, or declare completion before the final Goal Gate passes.
- Never mutate an approved fixed Work Plan during execution. Stop and create a new proposal revision when scope or Part meaning changes.
- Never merge, deploy, delete data, spend money, send or publish externally, or change permissions. These are human-only.
- Enforcement in the v1 protocol is advisory: nothing in SuperLoop physically prevents a violation. Treat these rules as absolute precisely because you are the only enforcement layer.
