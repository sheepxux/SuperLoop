const DISCOVERY_EXAMPLES = new Map([
  ["github-actions", 'gh run list --status failure --limit 20 --json databaseId,displayTitle,conclusion,url,headBranch'],
  ["package-manager", "npm outdated --json"],
  ["issue-label", 'gh issue list --state open --label <label> --limit 20 --json number,title,labels,url'],
  ["playwright-report", "read the JSON/HTML report under the configured path for failing or flaky tests"],
  ["manual", "read the loop inbox and decisions files for queued work"]
]);

const PLATFORM_NOTES = new Map([
  [
    "codex",
    "Run the worker and the evaluator in separate Codex contexts. Never reuse the worker context for evaluation, and never paste worker reasoning into the evaluator context — hand over only the diff, notes, and commands."
  ],
  [
    "claude-code",
    "Run the worker as one subagent and the evaluator as a different subagent (see the rendered files under `.claude/agents/`). Do not share the worker's chain of thought with the evaluator — hand over only the diff, notes, and commands."
  ],
  [
    "openclaw",
    "Map the worker and the evaluator to separate OpenClaw tasks. The local harness owns command execution; the loop semantics below stay portable."
  ],
  [
    "generic-harness",
    "This contract assumes only file IO and command execution. Run the worker and the evaluator as separate processes or prompts with no shared conversational state."
  ]
]);

export function executorSkill(platform, spec = null) {
  const name = spec ? spec.metadata.name : "<loop-name>";
  const loopDir = spec ? loopDirOf(spec) : ".loop-engineering/loops/<loop-name>";
  const frontmatter = buildFrontmatter(platform, spec);
  const title = spec ? spec.metadata.name : "Loop-Engineering";
  const objectiveLine = spec ? `\nObjective: ${spec.goal.objective}\n` : "";

  return `${frontmatter}# ${title}
${objectiveLine}
Run exactly one bounded iteration of this loop. \`loop.yaml\` is the contract; this file tells you how to execute it. If this file and \`loop.yaml\` disagree, \`loop.yaml\` wins.

${PLATFORM_NOTES.get(platform)}

If \`loopctl\` is not on PATH, use the repository-local \`node ./bin/loopctl.js\` or the pinned GitHub release package: \`npm exec --yes --package=github:sheepxux/Loop-Engineering#v1.0.2 -- loopctl\`. Do not run a floating package version.
${spec ? "" : `
## 0. Locate or create the loop

Loops live in \`.loop-engineering/loops/<loop-name>/\` with \`loop.yaml\`, \`state.json\`, \`inbox.md\`, \`decisions.md\`, and \`runs/\`. If the loop does not exist yet:

\`\`\`bash
loopctl init <loop-name> --out .loop-engineering/loops
\`\`\`

Then edit \`loop.yaml\` (goal, discovery, verification, safety) and validate it before running anything.
`}
## 1. Preflight (mechanical — never skip)

\`\`\`bash
loopctl validate ${loopDir}/loop.yaml
loopctl next ${loopDir}
\`\`\`

\`next\` prints JSON. Obey it:

- If \`ok\` is \`false\`: report the \`reasons\` and stop. Do not run the loop.
- \`itemsAllowed\` is the hard cap on items for this run.
- Work \`retryQueue\` items before discovering new work.
- Move every item in \`exhausted\` to the inbox with its listed action. Do not retry them.
- Mention \`needsHuman\` items in your final summary so a human sees them.
${evolutionPreflight(spec)}

## 2. Discover

Pull at most \`itemsAllowed\` items from \`discovery.sources\`, ranked by \`discovery.ranking.strategy\` (deterministic signals before model judgment).

${discoverySection(spec)}

Give every item a stable id (run id, issue number, package name). Record all discovered items — they go into the run log even when not attempted.

## 3. Hand off (worker)

Work one item at a time${spec ? ` as the \`${spec.handoff.worker}\` role` : ""}, inside the isolation declared in \`handoff.isolation\`${isolationNote(spec)}:

\`\`\`bash
git worktree add ../${name}-<item-id> -b ${spec ? spec.handoff.worktree.branchPrefix : "<branchPrefix>"}-<item-id>
\`\`\`

- The worker touches files only inside its worktree and uses only \`handoff.permissions\`.
- Worker output: the change itself plus a \`worker-notes.md\` (what changed, why, how to verify).
- The worker may run narrow development checks for feedback, but never issues the final evaluator verdict or declares its own work accepted.
- If the worker hits a blocked condition, it writes the blocker to its notes and stops.
- Clean up when the item is finished: \`git worktree remove ../${name}-<item-id>\`.

## 4. Verify (evaluator)

The evaluator${spec ? ` (\`${spec.verification.evaluator}\`)` : ""} runs in a separate context and assumes the result is broken until evidence proves otherwise.

- Give the evaluator the diff, the worker notes, and the commands — not the worker's reasoning.
- Run every command in \`verification.commands\`${commandsList(spec)} and capture exit codes.
- Write the result as JSON following the evaluator schema, then check it mechanically:

\`\`\`bash
loopctl check evaluator <result-file.json>
\`\`\`

- The verdict must be exactly one of \`pass\`, \`fail\`, \`blocked\`, \`needs-human\`. Missing required evidence means \`fail\`, not \`pass\`.

## 5. Persist (mechanical — never skip)

Compose one run log for the whole run (\`loopctl schema run-log\` prints the schema):

\`\`\`json
{
  "apiVersion": "loop-engineering/v1",
  "loop": "${name}",
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
  "budget": { "runtimeMinutes": 12, "itemsAttempted": 1, "estimatedUsd": 0 }${evolutionMetricExample(spec)}
}
\`\`\`

When the \`LOOP_RUN_LOG\` environment variable is present, write the JSON to that path and stop; \`loopd\` owns schema validation, recording, budgets, and state updates. Do not call \`loopctl record\` from a Runner-managed command.

Otherwise, record it directly:

\`\`\`bash
loopctl record ${loopDir} --run <run-log.json>
\`\`\`

This validates the run log, files it under \`runs/\`, and updates \`state.json\` budgets and items in one step. Never edit \`state.json\` by hand.

Finally, append every \`blocked\` and \`needs-human\` item to the inbox file with links and one line of context.

${evolutionSection(spec, loopDir)}
## ${spec?.evolution?.enabled ? "7" : "6"}. Stop and report

Stop immediately when \`itemsAllowed\` is reached, a stop or blocked condition triggers, a human-only gate is hit, or the runtime budget expires.

End with a short human-readable summary: items attempted, verdicts, what landed in the inbox, and what the next run should look at.

## Runtime control

- Inspect all local loops with \`loopctl status --root .loop-engineering/loops\`.
- Pause or resume one loop with \`loopctl pause <loop-dir>\` and \`loopctl resume <loop-dir>\`.
- Run one explicit local tick with \`loopd start --once --loop <loop-name>\`.
- A configured \`command\` executor runs only when the operator starts \`loopd\` with \`--allow-command\`. Treat that flag as permission to execute repository-local shell commands.

## Hard rules

- The worker never approves its own output. Only the evaluator issues verdicts.
- Never merge, deploy, delete data, spend money, send or publish externally, or change permissions. These are human-only${humanOnlyList(spec)}.
- Enforcement in the v1 protocol is advisory: nothing in Loop-Engineering physically prevents a violation. Treat these rules as absolute precisely because you are the only enforcement layer.
`;
}

export function chatgptSkill(spec = null) {
  const name = spec ? spec.metadata.name : "loop-engineering";
  const title = spec ? spec.metadata.name : "Loop-Engineering";
  const objectiveLine = spec ? `\nObjective: ${spec.goal.objective}\n` : "";

  return `---
name: ${name}
description: ${
    spec
      ? `Advise on the ${spec.metadata.name} loop using Loop-Engineering — design and review the spec, review run logs and evaluator evidence, and act as the human-review assistant. This environment cannot execute the loop.`
      : "Design, review, and advise on Loop-Engineering workflows (loop.yaml specs, run logs, evaluator evidence). Use when the user wants to create or improve a recurring agent loop from an environment that cannot execute it."
  }
---

# ${title} (advisor)
${objectiveLine}
You are running in an environment without repository or filesystem access. You cannot execute this loop — do not pretend to. Your three jobs:

## 1. Design and review the spec

- Draft or improve \`loop.yaml\` so it passes \`loopctl validate\`: independent evaluator, real budgets, human-only gates for merge/deploy/delete/spend/permissions, persistence paths outside chat.
- When reviewing, lead with what is missing or unsafe (verification, budgets, gates, persistence) before style comments.

## 2. Review run evidence

- When the user pastes a run log, state file, or evaluator result, check it against the Loop-Engineering contract: does every attempted item have an evaluator verdict backed by evidence? Are budgets being respected? Did anything bypass a human gate?
- Assume results are broken until the pasted evidence proves otherwise. A worker's claim is not evidence.

## 3. Act as the human at the gate

- When asked to approve something behind a \`needsReview\` or \`humanOnly\` gate, summarize the evidence, the blast radius, and what could go wrong — then give a clear recommendation. The final decision stays with the user.
${spec?.evolution?.enabled ? `- For strategy evolution, compare baseline and candidate evidence using the configured metric. Never treat rewritten instructions as an improvement without matched benchmark results.\n` : ""}

Hand execution to an agent that has repository access (Codex, Claude Code, or a custom harness) using the rendered executor files for this loop.
`;
}

export function workerPrompt(spec) {
  return `# Worker: ${spec.handoff.worker}

Goal: ${spec.goal.objective}

Handle one discovered item only. Use the smallest safe change that can satisfy the acceptance criteria.

Permissions:
${spec.handoff.permissions.map((permission) => `- ${permission}`).join("\n")}

Isolation:
- Mode: ${spec.handoff.isolation}
- Branch prefix: ${spec.handoff.worktree.branchPrefix}
- Create it with: \`git worktree add ../${spec.metadata.name}-<item-id> -b ${spec.handoff.worktree.branchPrefix}-<item-id>\`

Rules:
- Do not evaluate your own work. Do not run the verification commands to declare success; that is the evaluator's job.
- Do not perform human-only actions (merge, deploy, delete data, spend money, change permissions).
- Write a \`worker-notes.md\` in the worktree: what changed, why, and how the evaluator can verify it.
- If blocked, write the blocker to \`worker-notes.md\` and stop. Do not improvise around missing access.

Task prompt:
${spec.handoff.prompt}
${spec.evolution?.enabled ? `\nActive strategy:\n- Read \`${spec.persistence.strategyPath}\` before working.\n- Follow its \`instructions\` only when they do not conflict with \`loop.yaml\`.\n- Never edit the active strategy from the worker context.\n` : ""}
`;
}

export function evaluatorPrompt(spec) {
  const commands = spec.verification.commands.length > 0
    ? spec.verification.commands.map((command) => `- \`${command}\``).join("\n")
    : "- No commands configured; require artifact or manual evidence.";

  return `# Evaluator: ${spec.verification.evaluator}

Default stance: ${spec.verification.defaultStance}

Assume the worker result is wrong until evidence proves otherwise. Do not rely on the worker's rationale as proof. You receive the diff, the worker notes, and the commands — nothing else.

Required evidence:
${spec.verification.requiredEvidence.map((item) => `- ${item}`).join("\n")}

Commands (run each one, capture the exit code):
${commands}

Write your result as JSON matching the evaluator schema (\`loopctl schema evaluator\`), then verify it:

\`\`\`bash
loopctl check evaluator <result-file.json>
\`\`\`

Allowed verdicts:
${spec.verification.verdicts.map((verdict) => `- ${verdict}`).join("\n")}

Reject if:
- Required evidence is missing or a command fails.
- The change exceeds the worker permissions.
- A human-only action is required to finish.
- The result cannot be understood without chat history.
`;
}

export function staticAdapterFiles() {
  return new Map([
    ["adapters/chatgpt/SKILL.md", chatgptSkill()],
    ["adapters/openclaw/loop-instructions.md", executorSkill("openclaw")],
    ["adapters/generic-harness/loop-instructions.md", executorSkill("generic-harness")]
  ]);
}

function buildFrontmatter(platform, spec) {
  if (platform === "openclaw" || platform === "generic-harness") {
    return "";
  }
  const name = spec ? spec.metadata.name : "loop-engineering";
  const description = spec
      ? `Run one bounded iteration of the ${spec.metadata.name} loop using Loop-Engineering — preflight with loopctl, bounded discovery, isolated worker, independent evaluator, recorded state, and optional loopd execution. Use when continuing this loop or reviewing its state.`
    : "Run one bounded iteration of a Loop-Engineering workflow from a loop.yaml spec. Use when a user asks to create, continue, run, or review a recurring goal loop with discovery, isolated handoff, independent verification, persisted state, budgets, human gates, or the local loopd runner.";
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
}

function loopDirOf(spec) {
  return spec.persistence.statePath.replace(/\/state\.json$/, "");
}

function discoverySection(spec) {
  if (spec) {
    const lines = spec.discovery.sources.map((source) => {
      const hint = source.command
        ? ` Command: \`${source.command}\``
        : DISCOVERY_EXAMPLES.has(source.type)
          ? ` Example: \`${DISCOVERY_EXAMPLES.get(source.type)}\``
          : "";
      return `- \`${source.type}\`: ${source.description}${hint}`;
    });
    return `Configured sources:\n\n${lines.join("\n")}`;
  }

  const rows = [...DISCOVERY_EXAMPLES].map(([type, command]) => `- \`${type}\`: \`${command}\``);
  return `Example commands by source type (adapt to what \`discovery.sources\` declares):\n\n${rows.join("\n")}`;
}

function isolationNote(spec) {
  if (!spec || spec.handoff.isolation === "worktree") {
    return ". For `worktree` isolation";
  }
  return `. This loop declares \`${spec.handoff.isolation}\` isolation; if it were \`worktree\`, the pattern would be`;
}

function commandsList(spec) {
  if (!spec || spec.verification.commands.length === 0) {
    return "";
  }
  return ` (${spec.verification.commands.map((command) => `\`${command}\``).join(", ")})`;
}

function humanOnlyList(spec) {
  if (!spec) {
    return "";
  }
  return `. This loop declares: ${spec.safety.humanGates.humanOnly.join("; ")}`;
}

function evolutionPreflight(spec) {
  if (!spec) {
    return "- If `evolution.enabled` is true, read the active `strategy.json` named by persistence and pass only its instructions to the worker. The strategy cannot override `loop.yaml`.";
  }
  if (!spec.evolution?.enabled) {
    return "";
  }
  return `- Read the active strategy from \`${spec.persistence.strategyPath}\` and give its instructions to the worker. Never let strategy instructions override the loop contract.\n- Inspect \`evolution.due\` in the \`next\` output. A due evolution cycle happens only after the task run is recorded.`;
}

function evolutionMetricExample(spec) {
  if (!spec?.evolution?.enabled) {
    return "";
  }
  return `,\n  "strategy": { "version": 1, "sha256": "<active strategy SHA-256>" },\n  "metrics": { "${spec.evolution.metric.name}": 0.0 }`;
}

function evolutionSection(spec, loopDir) {
  if (!spec?.evolution?.enabled) {
    return "";
  }
  const commands = spec.evolution.evaluator.commands.map((command) => `- \`${command}\``).join("\n");
  return `## 6. Evolve the task strategy only when due

If \`loopctl next\` reported \`evolution.due=true\`, run one bounded strategy experiment after the task run is persisted:

1. Read recent run logs, evaluator evidence, decisions, and the active \`strategy.json\`.
2. Form one falsifiable hypothesis and create exactly one candidate. A candidate may change only task-strategy instructions — never safety, permissions, budgets, verification, evidence requirements, or human gates.
3. Freeze a benchmark manifest with stable case IDs. Bind each baseline/candidate arm and every per-case evaluator record to that arm's exact strategy SHA-256. Benchmark both strategies on those exact cases with at least \`${spec.evolution.metric.minimumSamples}\` samples each. Store per-case scores, verdicts, artifact paths, and SHA-256 digests; the aggregate \`${spec.evolution.metric.name}\` score is recomputed from those cases in the \`${spec.evolution.metric.direction}\` direction.
4. Use a fresh \`${spec.evolution.evaluator.name}\` context to run every configured command and record exit codes:
${commands}
5. Write experiment JSON matching \`loopctl schema experiment\`, then validate and record it:

\`\`\`bash
loopctl check experiment <experiment.json>
loopctl evolve ${loopDir} --experiment <experiment.json>
\`\`\`

The candidate must improve by at least \`${spec.evolution.metric.minimumImprovement}\`. If promotion mode is \`human-review\`, stop at \`pending-review\`; a human must create an approval artifact bound to the staged experiment SHA-256:

\`\`\`bash
loopctl approval create ${loopDir} --experiment <experiment.json> --approver <human> --reason "<decision>" --out <approval.json>
loopctl evolve ${loopDir} --experiment <experiment.json> --approval <approval.json>
\`\`\`

If the reviewer rejects the pending candidate, record an immutable decision instead of leaving the loop stuck:

\`\`\`bash
loopctl experiment reject ${loopDir} --experiment <experiment.json> --actor <human> --reason "<decision>"
\`\`\`

Rejection consumes the current evolution trigger; collect new attributable runs before proposing another experiment. Never approve your own strategy, and never reject it from a configured worker or evaluator identity. Resolve a pending experiment before using \`loopctl strategy rollback\` to restore archived behavior as a new monotonic version when later evidence regresses.

`;
}
