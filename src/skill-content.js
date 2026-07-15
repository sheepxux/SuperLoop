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
  const approvedGoalContract = renderedGoalSection(spec);
  const approvedWorkPlan = workPlanSection(spec);

  return `${frontmatter}# ${title}
${objectiveLine}
Run exactly one bounded iteration of this loop. \`loop.yaml\` is the contract; this file tells you how to execute it. If this file and \`loop.yaml\` disagree, \`loop.yaml\` wins.

${approvedGoalContract}
${approvedWorkPlan}

${PLATFORM_NOTES.get(platform)}

If \`loopctl\` is not on PATH, use the repository-local \`node ./bin/loopctl.js\` or the pinned GitHub release package: \`npm exec --yes --package=github:sheepxux/Loop-Engineering#v1.1.0 -- loopctl\`. Do not run a floating package version.
${spec ? "" : `
## 0. Locate an approved loop

Loops live in \`.loop-engineering/loops/<loop-name>/\` with \`loop.yaml\`, \`state.json\`, \`inbox.md\`, \`decisions.md\`, and \`runs/\`. If the loop does not exist, stop this executor workflow. Use the canonical \`$loop-engineering\` Skill to create a non-executable \`LoopProposal\`, obtain a digest-bound human decision, and compile \`loop.yaml\` before initialization:

\`\`\`bash
loopctl proposal validate proposal.yaml
loopctl proposal compile proposal.yaml --decision proposal-decision.json --out loop.yaml
loopctl init <loop-name> --from loop.yaml --out .loop-engineering/loops
\`\`\`

Never create or approve the proposal from this executor instance.
`}
## 1. Preflight (mechanical — never skip)

\`\`\`bash
loopctl validate ${loopDir}/loop.yaml
loopctl next ${loopDir}
\`\`\`

\`next\` prints JSON. Obey it:

- If \`ok\` is \`false\`: report the \`reasons\` and stop. Do not run the loop.
- \`itemsAllowed\` is the hard cap on items for this run.
- Work \`retryQueue\` items before untouched eligible work.
- Move every item in \`exhausted\` to the inbox with its listed action. Do not retry them.
- Mention \`needsHuman\` items in your final summary so a human sees them.
${workPlanPreflight(spec)}
${evolutionPreflight(spec)}

## 2. Select eligible work

${executionSelectionSection(spec)}

## 3. Hand off (worker)

Work one selected item or eligible Part at a time${spec ? ` as the \`${spec.handoff.worker}\` role` : ""}. Use only the isolation declared in \`handoff.isolation\`:

${executorIsolationInstructions(spec, name)}

- The worker stays inside the selected isolation boundary and uses only \`handoff.permissions\`.
- Worker output: the change itself plus a \`worker-notes.md\` (what changed, why, how to verify).
- The worker may run narrow development checks for feedback, but never issues the final evaluator verdict or declares its own work accepted.
- If the worker hits a blocked condition, it writes the blocker to its notes and stops.
${workPlanWorkerRules(spec)}

## 4. Verify the current phase

${phaseVerificationSection(spec)}

## 5. Persist (mechanical — never skip)

Compose one run log for the whole run (\`loopctl schema run-log\` prints the schema):

${runLogExample(spec, name)}

When the \`LOOP_RUN_LOG\` environment variable is present, write the JSON to that path and stop; \`loopd\` owns schema validation, recording, budgets, and state updates. Do not call \`loopctl record\` from a Runner-managed command.

Otherwise, record it directly:

\`\`\`bash
loopctl record ${loopDir} --run <run-log.json>
\`\`\`

This validates the run log, files it under \`runs/\`, and updates \`state.json\` budgets and items in one step. Never edit \`state.json\` by hand.

Finally, append every \`blocked\` and \`needs-human\` item to the inbox file with links and one line of context.

${evolutionSection(spec, loopDir)}
## ${spec?.evolution?.enabled ? "7" : "6"}. Stop and report

Stop immediately when phase is \`completed\`, \`itemsAllowed\` is reached, a stop or blocked condition triggers, a human-only gate is hit, or the runtime budget expires.

End with a short human-readable summary: phase, items or Parts attempted, verdicts, eligible and locked Parts, Goal Gate outcome, what landed in the inbox, and what the next run should look at.

## Runtime control

- Inspect all local loops with \`loopctl status --root .loop-engineering/loops\`.
- Pause or resume one loop with \`loopctl pause <loop-dir>\` and \`loopctl resume <loop-dir>\`.
- Run one explicit local tick with \`loopd start --once --loop <loop-name>\`.
- A configured \`command\` executor runs only when the operator starts \`loopd\` with \`--allow-command\`. Treat that flag as permission to execute repository-local shell commands.

## Hard rules

- The worker never approves its own output. Only the evaluator issues verdicts.
- One Loop owns the whole Goal. A Part is one bounded unit and an iteration is one attempt; never create a nested Loop for each Part.
- Never work a locked or out-of-plan Part, advance after a failed Part Gate, or declare completion before the final Goal Gate passes.
- Never mutate an approved fixed Work Plan during execution. Stop and create a new proposal revision when scope or Part meaning changes.
- Never merge, deploy, delete data, spend money, send or publish externally, or change permissions. These are human-only${humanOnlyList(spec)}.
- Enforcement in the v1 protocol is advisory: nothing in Loop-Engineering physically prevents a violation. Treat these rules as absolute precisely because you are the only enforcement layer.
`;
}

function goalContractSection(spec) {
  if (!spec?.goalContract) return "";
  const contract = spec.goalContract;
  const acceptance = contract.acceptanceCriteria
    .map((criterion) => (
      `- ${criterion.id}: ${criterion.statement}\n`
      + `  - Pass only when: ${criterion.passCondition}\n`
      + `  - Evidence: ${criterion.evidence.join(", ")}`
    ))
    .join("\n");
  const nonGoals = contract.nonGoals
    .map((item) => `- ${item.id}: ${item.condition}`)
    .join("\n");
  const stopConditions = contract.stopConditions
    .map((item) => `- ${item.id}: ${item.condition}`)
    .join("\n");
  const blockedConditions = contract.blockedConditions
    .map((item) => `- ${item.id}: ${item.condition}`)
    .join("\n");
  return `## Approved Goal Contract

Outcome: ${contract.objective.outcome}

Measurement: ${contract.objective.measurement}

Acceptance criteria:

${acceptance}

Non-goals (must not be violated):

${nonGoals}

Stop conditions:

${stopConditions}

Blocked conditions:

${blockedConditions}
`;
}

function renderedGoalSection(spec) {
  if (!spec) return "";
  if (spec.goalContract) return goalContractSection(spec);
  return `## Loop Goal

Objective: ${spec.goal.objective}

Acceptance criteria:

${spec.goal.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}

Stop conditions:

${spec.goal.stopConditions.map((condition) => `- ${condition}`).join("\n")}

Blocked conditions:

${spec.goal.blockedConditions.map((condition) => `- ${condition}`).join("\n")}
`;
}

function workPlanSection(spec) {
  if (!spec?.workPlan) return "";
  const parts = spec.workPlan.parts.map((part, index) => {
    const dependencies = part.dependsOn.length > 0 ? part.dependsOn.join(", ") : "none";
    const goalCriteria = part.goalCriteria.map((criterion) => `     - ${criterion}`).join("\n");
    const acceptance = part.acceptanceCriteria.map((criterion) => (
      `     - ${criterion.id}: ${criterion.statement}\n`
      + `       - Pass only when: ${criterion.passCondition}\n`
      + `       - Evidence: ${criterion.evidence.join(", ")}`
    )).join("\n");
    const artifacts = part.expectedArtifacts
      .map((artifact) => `     - ${artifact.id}: ${artifact.description}`)
      .join("\n");
    const verification = part.verification || spec.verification;
    const verificationCommands = verification.commands.length > 0
      ? verification.commands.map((command) => `\`${command}\``).join(", ")
      : "none; require the declared non-command evidence";
    return `${index + 1}. **${part.id} — ${part.title}**
   - Objective: ${part.objective}
   - Depends on: ${dependencies}
   - Goal criteria advanced:
${goalCriteria}
   - Part Gate:
${acceptance}
   - Effective verification evidence: ${verification.requiredEvidence.join(", ")}
   - Effective verification commands: ${verificationCommands}${part.verification ? " (Part-specific override)" : " (Loop-level default)"}
   - Expected artifacts:
${artifacts}`;
  }).join("\n");
  const completion = spec.workPlan.completion;
  const completionCommands = completion.commands.length > 0
    ? completion.commands.map((command) => `  - \`${command}\``).join("\n")
    : "  - No command configured; require the declared artifact or manual evidence.";
  return `## Approved fixed Work Plan

One Loop owns the whole Goal. Each Part is a bounded unit; an iteration is one attempt. At most ${spec.workPlan.maxPartsPerRun} already eligible Part(s) may be attempted per run.

${parts}

Final Goal Gate:

- Evaluator: ${completion.evaluator}
- Required evidence: ${completion.requiredEvidence.join(", ")}
- Maximum attempts: ${completion.maxAttempts}
- Commands:
${completionCommands}

The plan is immutable during execution. A scope, Part, dependency, artifact, criterion, or completion-policy change requires a new proposal revision and human decision.
`;
}

function workPlanPreflight(spec) {
  if (spec?.workPlan) {
    return `- This is a finite Work Plan. Obey \`phase\`: \`work\`, \`goal-evaluation\`, or \`completed\`.
- In \`work\`, use only \`eligibleParts\` and bind the exact \`partDefinitionSha256\`; never touch \`lockedParts\`.
- In \`goal-evaluation\`, use exactly \`goalEvaluationBasisSha256\` and do not run a Part worker.
- In \`completed\`, report completion and stop; the Loop is non-runnable.`;
  }
  if (spec) return "";
  return `- If \`phase\`, \`eligibleParts\`, and \`lockedParts\` are present, this is a finite Work Plan: obey the phase and exact Part digests instead of discovering new work.
- If \`phase\` is \`goal-evaluation\`, do not run a worker. If it is \`completed\`, stop.`;
}

function executionSelectionSection(spec) {
  if (spec?.workPlan) {
    return `This Loop uses an approved fixed Work Plan; do not discover or append items.

- If \`phase=work\`, select at most \`itemsAllowed\` and \`workPlan.maxPartsPerRun\` IDs from \`eligibleParts\`, in returned order. Prefer a failed retry. Copy each exact \`partDefinitionSha256\` into its evaluator result and run result.
- Treat every ID in \`lockedParts\` as unavailable even if it looks useful.
- If \`phase=goal-evaluation\`, skip the worker and perform only the final Goal Gate in section 4.
- If \`phase=completed\`, stop without creating a run.`;
  }
  const discovery = `Pull at most \`itemsAllowed\` items from \`discovery.sources\`, ranked by \`discovery.ranking.strategy\` (deterministic signals before model judgment).

${discoverySection(spec)}

Give every item a stable id (run id, issue number, package name). Record all discovered items — they go into the run log even when not attempted.`;
  if (spec) return discovery;
  return `When \`next\` has no finite Work Plan phase, use continuous discovery:

${discovery}

When \`next\` reports a finite phase, do not discover anything: in \`work\`, select only returned \`eligibleParts\`; in \`goal-evaluation\`, skip the worker; in \`completed\`, stop.`;
}

function workPlanWorkerRules(spec) {
  if (spec?.workPlan) {
    return `- Give the worker the exact eligible Part definition and digest. Require every declared expected artifact ID as a durable output.
- The worker targets the active Part criteria, while preserving whole-Goal non-goals and safety. It does not claim that an intermediate Part completes the Goal.
- Do not run a worker in \`goal-evaluation\` or \`completed\` phase.`;
  }
  if (spec) return "";
  return "- For a finite Work Plan, give the worker exactly one returned eligible Part, its digest, Part criteria, dependencies, and expected artifact IDs. Never run a worker in `goal-evaluation` or `completed`.";
}

function phaseVerificationSection(spec) {
  const continuous = `The evaluator${spec ? ` (\`${spec.verification.evaluator}\`)` : ""} runs in a separate context and assumes the result is broken until evidence proves otherwise.

- Give the evaluator the diff or artifact, worker notes, and commands — not the worker's reasoning.
- Run every command in \`verification.commands\`${commandsList(spec)} and capture exit codes.
- Write JSON matching the evaluator schema and run \`loopctl check evaluator <result-file.json>\`.
- The verdict must be \`pass\`, \`fail\`, \`blocked\`, or \`needs-human\`. Missing required evidence means \`fail\`.
${spec?.goalContract ? "- For continuous work, check every exact Goal Contract pass condition and required evidence item. A non-goal violation or unmet pass condition means `fail`." : ""}`;

  if (spec && !spec.workPlan) return continuous;
  const partEvaluator = spec?.verification.evaluator || "the configured Part evaluator";
  const goalEvaluator = spec?.workPlan?.completion.evaluator || "workPlan.completion.evaluator";
  const goalCommands = spec?.workPlan?.completion.commands?.length
    ? ` Run: ${spec.workPlan.completion.commands.map((command) => `\`${command}\``).join(", ")}.`
    : "";
  const finite = `For a finite Work Plan, use the phase-specific gate:

**Part Gate (\`phase=work\`)**

- Use a fresh \`${partEvaluator}\` context.
- Evaluate only the exact active Part acceptance criteria, expected artifacts, global non-goals, blocked conditions, permissions, and safety policy. Do not fail an intermediate Part merely because the whole Goal is not complete.
- Bind \`itemId\` and \`partDefinitionSha256\` exactly to the selected \`eligibleParts\` entry.
- Include one passing \`criteria\` record for every exact Part criterion ID and the exact \`artifacts\` set declared by that Part; every artifact needs its ID, reference, and SHA-256.
- Run the active Part's \`verification.commands\` when declared; otherwise run the Loop-level \`verification.commands\`. Require the matching effective evidence, write evaluator JSON, and check it with \`loopctl check evaluator <result-file.json>\`.

**Final Goal Gate (\`phase=goal-evaluation\`)**

- Do not run a worker, discover items, or include Part results.
- Use a fresh \`${goalEvaluator}\` context, independent from the worker and distinct from every Part-evaluation context.${goalCommands}
- Bind \`basisSha256\` exactly to \`goalEvaluationBasisSha256\` from \`loopctl next\`.
- Record exactly one criterion result for every exact string in \`goal.acceptanceCriteria\`, require all configured completion evidence and commands, and name \`affectedParts\` on failure.
- Write JSON matching \`loopctl schema goal-evaluation\`, then run \`loopctl check goal-evaluation <goal-evaluation.json>\`.
- Only \`verdict=pass\` with \`nextAction=complete\` completes the Loop. Failure reopens the recorded affected Parts and descendants; \`blocked\` or \`needs-human\` stops.

If \`phase=completed\`, do not evaluate or record another run.`;
  if (spec?.workPlan) return finite;
  return `${continuous}

${finite}`;
}

function runLogExample(spec, name) {
  const continuous = `\`\`\`json
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
\`\`\``;
  if (spec && !spec.workPlan) return continuous;
  const finite = `For finite \`phase=work\`, \`discovered\` must be empty and the result binds the approved Part:

\`\`\`json
{
  "apiVersion": "loop-engineering/v1",
  "loop": "${name}",
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
  "budget": { "runtimeMinutes": 12, "itemsAttempted": 1, "estimatedUsd": 0 }${evolutionMetricExample(spec)}
}
\`\`\`

For \`phase=goal-evaluation\`, both \`discovered\` and \`results\` must be empty; bind the final evaluator artifact:

\`\`\`json
{
  "apiVersion": "loop-engineering/v1",
  "loop": "${name}",
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
\`\`\``;
  if (spec?.workPlan) return finite;
  return `For continuous discovery:\n\n${continuous}\n\n${finite}`;
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
      : "Design, review, and advise on Loop-Engineering workflows (loop.yaml specs, fixed Work Plans, run logs, evaluator evidence). Use when the user wants to create or improve a recurring or finite long-horizon agent loop from an environment that cannot execute it."
  }
---

# ${title} (advisor)
${objectiveLine}
${renderedGoalSection(spec)}
${workPlanSection(spec)}
You are running in an environment without repository or filesystem access. You cannot execute this loop — do not pretend to. Your jobs:

## 1. Turn a vague idea into a reviewable proposal

- Classify it as one-shot, deterministic, agentic-loop, or unsafe-loop. Recommend a smaller mechanism and stop when a loop is unnecessary.
- Ask no more than three material questions. State safe assumptions explicitly; never invent authority, credentials, or external-write permission.
- Draft a non-executable Goal Contract and LoopProposal with outcome, measurement, evidence-bearing pass conditions, non-goals, stop/blocked conditions, prerequisites, budgets, and human gates. Route finite composite work to one fixed Work Plan inside one Loop; keep continuous streams on bounded discovery.
- For a finite plan, show stable Parts, dependencies, expected artifacts, Part Gates, and the independent final Goal Gate. Never call each Part a separate Loop.
- Stop for the user's review. Never claim to validate, approve, compile, initialize, schedule, or execute an artifact from this environment.

## 2. Design and review the spec

- Draft or improve \`loop.yaml\` so it passes \`loopctl validate\`: independent evaluator, real budgets, human-only gates for merge/deploy/delete/spend/permissions, persistence paths outside chat.
- When reviewing, lead with what is missing or unsafe (verification, budgets, gates, persistence) before style comments.

## 3. Review run evidence

- When the user pastes a run log, state file, or evaluator result, check it against the Loop-Engineering contract: does every attempted item have an evaluator verdict backed by evidence? For finite work, was each Part eligible and digest-bound, did its exact Part Gate pass, and did the final Goal Gate cover every exact Goal criterion? Are budgets being respected? Did anything bypass a human gate?
- Assume results are broken until the pasted evidence proves otherwise. A worker's claim is not evidence.

## 4. Assist the human at the gate

- When asked to approve something behind a \`needsReview\` or \`humanOnly\` gate, summarize the evidence, the blast radius, and what could go wrong — then give a clear recommendation. The final decision stays with the user.
${spec?.evolution?.enabled ? `- For strategy evolution, compare baseline and candidate evidence using the configured metric. Never treat rewritten instructions as an improvement without matched benchmark results.\n` : ""}

Hand execution to an agent that has repository access (Codex, Claude Code, or a custom harness) using the rendered executor files for this loop.
`;
}

function workerIsolationSection(spec) {
  if (spec.handoff.isolation === "worktree") {
    return `- Mode: worktree
- Branch prefix: ${spec.handoff.worktree.branchPrefix}
- Create it with: \`git worktree add ../${spec.metadata.name}-<item-id> -b ${spec.handoff.worktree.branchPrefix}-<item-id>\``;
  }
  if (spec.handoff.isolation === "branch") {
    return `- Mode: branch
- Use a caller-provided isolated branch derived from \`${spec.handoff.worktree.branchPrefix}\`; do not merge it or reuse another item's branch.`;
  }
  if (spec.handoff.isolation === "task-directory") {
    return `- Mode: task-directory
- Use the caller-provided isolated task directory. Keep editable files and worker notes inside that boundary; emit accepted evidence only through approved Loop artifact paths.`;
  }
  if (spec.handoff.isolation === "thread") {
    return `- Mode: thread
- Use the caller-provided isolated thread/context and persist all deliverables and evidence to the approved Loop artifact paths rather than relying on chat memory.`;
  }
  return `- Mode: none
- No write isolation is configured. Perform only the contract's non-writing permissions; stop if the task would modify state or files.`;
}

function executorIsolationInstructions(spec, name) {
  if (!spec) {
    return `- \`worktree\`: create one item-specific worktree from the configured branch prefix; remove it after evidence has been persisted.
- \`branch\`: use one caller-provided item-specific branch; never merge it from the worker context.
- \`task-directory\`: use one caller-provided isolated directory; keep edits and notes inside it.
- \`thread\`: use one caller-provided isolated context and persist outputs to approved artifact paths.
- \`none\`: perform only non-writing work; stop before any mutation.`;
  }
  if (spec.handoff.isolation === "worktree") {
    return `Create one item-specific worktree:

\`\`\`bash
git worktree add ../${name}-<item-id> -b ${spec.handoff.worktree.branchPrefix}-<item-id>
\`\`\`

After accepted evidence and notes have been persisted, clean it up with \`git worktree remove ../${name}-<item-id>\`.`;
  }
  if (spec.handoff.isolation === "branch") {
    return `Use a caller-provided item-specific branch derived from \`${spec.handoff.worktree.branchPrefix}\`. Do not reuse another item's branch, merge it, or perform any other human-only action.`;
  }
  if (spec.handoff.isolation === "task-directory") {
    return "Use the caller-provided isolated task directory. Keep all editable files and worker notes inside it, and persist evaluator inputs only through approved Loop artifact paths.";
  }
  if (spec.handoff.isolation === "thread") {
    return "Use the caller-provided isolated thread or agent context. Persist every deliverable and evidence reference to approved Loop artifact paths; chat memory is not durable state.";
  }
  return "No write isolation is configured. Perform only the contract's non-writing permissions and stop before modifying files, external state, or durable data.";
}

export function workerPrompt(spec) {
  return `# Worker: ${spec.handoff.worker}

Goal: ${spec.goal.objective}

${renderedGoalSection(spec)}
${workPlanSection(spec)}

${spec.workPlan
    ? "Handle exactly one runtime-selected eligible Part. The caller must supply the exact Part definition and `partDefinitionSha256` returned by `loopctl next`; refuse a locked, missing, or digest-mismatched Part. Satisfy the active Part criteria and produce every declared expected artifact. Do not claim the intermediate Part completes the whole Goal."
    : "Handle one discovered item only. Use the smallest safe change that can satisfy the acceptance criteria."}

Permissions:
${spec.handoff.permissions.map((permission) => `- ${permission}`).join("\n")}

Isolation:
${workerIsolationSection(spec)}

Rules:
- Do not evaluate your own work. Do not run the verification commands to declare success; that is the evaluator's job.
- Do not perform human-only actions (merge, deploy, delete data, spend money, change permissions).
- Write a \`worker-notes.md\` in the active isolated workspace or approved Loop artifact directory: what changed, why, and how the evaluator can verify it.
- If blocked, record the blocker in \`worker-notes.md\` and stop. Do not improvise around missing access.

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

Assume the worker result is wrong until evidence proves otherwise. Do not rely on the worker's rationale as proof. ${spec.workPlan
    ? "This is the Part evaluator, not the final Goal evaluator. The caller must provide one exact eligible Part definition and digest. Evaluate only that Part's criteria and expected artifacts, plus global non-goals, blocked conditions, permissions, and safety. Do not reject an intermediate Part merely because the whole Goal is unfinished."
    : spec.goalContract
      ? "Evaluate against the exact approved Goal Contract below using the diff, worker notes, and command evidence."
      : "Evaluate against the loop goal and acceptance criteria using the diff, worker notes, and command evidence."}

${renderedGoalSection(spec)}
${workPlanSection(spec)}

${spec.workPlan ? "Loop-level default evidence (use the active Part's verification override when declared):" : "Required evidence:"}
${spec.verification.requiredEvidence.map((item) => `- ${item}`).join("\n")}

${spec.workPlan ? "Loop-level default commands (use the active Part's verification override when declared):" : "Commands (run each one, capture the exit code):"}
${commands}

Write your result as JSON matching the evaluator schema (\`loopctl schema evaluator\`), then verify it:

\`\`\`bash
loopctl check evaluator <result-file.json>
\`\`\`

Allowed verdicts:
${spec.verification.verdicts.map((verdict) => `- ${verdict}`).join("\n")}

Reject if:
- Required evidence is missing or a command fails.
${spec.workPlan
    ? "- Any exact active Part criterion is missing or fails, `partDefinitionSha256` differs from `loopctl next`, a declared artifact ID/reference/digest is missing, or a global non-goal is violated."
    : spec.goalContract
      ? "- Any exact Goal Contract pass condition is unmet or any non-goal is violated."
      : ""}
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
      ? `Run one bounded iteration of the ${spec.metadata.name} loop using Loop-Engineering — preflight with loopctl, eligible Parts or bounded discovery, independent gates, recorded state, and optional loopd execution. Use when continuing this loop or reviewing its state.`
    : "Run one bounded iteration of a Loop-Engineering workflow from a loop.yaml spec. Use when a user asks to create, continue, run, or review a recurring or finite goal loop with Work Plans or discovery, isolated handoff, independent verification, persisted state, budgets, human gates, or the local loopd runner.";
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
