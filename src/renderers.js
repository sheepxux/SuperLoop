import path from "node:path";
import { writeText, writeYaml } from "./fs-utils.js";
import { chatgptSkill, evaluatorPrompt, executorSkill, workerPrompt } from "./skill-content.js";

export const RENDERERS = new Set([
  "codex",
  "claude-code",
  "chatgpt",
  "openclaw",
  "generic-harness",
  "github-actions"
]);

export function renderAdapter(adapter, spec, outDir) {
  if (!RENDERERS.has(adapter)) {
    throw new Error(`Unknown adapter "${adapter}". Supported: ${[...RENDERERS].join(", ")}`);
  }

  if (adapter === "codex") return renderCodex(spec, outDir);
  if (adapter === "claude-code") return renderClaudeCode(spec, outDir);
  if (adapter === "chatgpt") return renderChatGPT(spec, outDir);
  if (adapter === "openclaw") return renderOpenClaw(spec, outDir);
  if (adapter === "generic-harness") return renderGenericHarness(spec, outDir);
  if (adapter === "github-actions") return renderGitHubActions(spec, outDir);
}

function renderCodex(spec, outDir) {
  const skillDir = path.join(outDir, "codex", "loop-engineering");
  writeYaml(path.join(skillDir, "loop.yaml"), spec);
  writeText(path.join(skillDir, "SKILL.md"), executorSkill("codex", spec));
  writeText(path.join(skillDir, "worker-prompt.md"), workerPrompt(spec));
  writeText(path.join(skillDir, "evaluator-prompt.md"), evaluatorPrompt(spec));
  return [skillDir];
}

function renderClaudeCode(spec, outDir) {
  const skillDir = path.join(outDir, ".claude", "skills", spec.metadata.name);
  const agentDir = path.join(outDir, ".claude", "agents");
  writeYaml(path.join(skillDir, "loop.yaml"), spec);
  writeText(path.join(skillDir, "SKILL.md"), executorSkill("claude-code", spec));
  writeText(path.join(agentDir, `${slug(spec.handoff.worker)}.md`), workerPrompt(spec));
  writeText(path.join(agentDir, `${slug(spec.verification.evaluator)}.md`), evaluatorPrompt(spec));
  return [skillDir, agentDir];
}

function renderChatGPT(spec, outDir) {
  const dir = path.join(outDir, "chatgpt", spec.metadata.name);
  writeYaml(path.join(dir, "loop.yaml"), spec);
  writeText(path.join(dir, "instructions.md"), chatgptSkill(spec));
  return [dir];
}

function renderOpenClaw(spec, outDir) {
  const dir = path.join(outDir, "openclaw", spec.metadata.name);
  writeYaml(path.join(dir, "loop.yaml"), spec);
  writeText(path.join(dir, "loop-instructions.md"), executorSkill("openclaw", spec));
  writeText(path.join(dir, "worker-prompt.md"), workerPrompt(spec));
  writeText(path.join(dir, "evaluator-prompt.md"), evaluatorPrompt(spec));
  return [dir];
}

function renderGenericHarness(spec, outDir) {
  const dir = path.join(outDir, "generic-harness", spec.metadata.name);
  writeYaml(path.join(dir, "loop.yaml"), spec);
  writeText(path.join(dir, "loop-contract.md"), executorSkill("generic-harness", spec));
  writeText(path.join(dir, "worker-prompt.md"), workerPrompt(spec));
  writeText(path.join(dir, "evaluator-prompt.md"), evaluatorPrompt(spec));
  return [dir];
}

function renderGitHubActions(spec, outDir) {
  const dir = path.join(outDir, ".github", "workflows");
  const file = path.join(dir, `${spec.metadata.name}.yml`);
  const loopDir = spec.persistence.statePath.replace(/\/state\.json$/, "");
  const specFile = path.join(outDir, loopDir, "loop.yaml");
  const cron = spec.schedule.runtime === "github-actions" ? spec.schedule.cadence : "0 9 * * 1-5";
  writeYaml(specFile, spec);
  writeText(file, githubActionYaml(spec, cron, loopDir));
  return [file, specFile];
}

function githubActionYaml(spec, cron, loopDir) {
  return `name: ${spec.metadata.name}

on:
  workflow_dispatch:
  schedule:
    - cron: "${cron}"

concurrency:
  group: ${spec.schedule.concurrency.group}
  cancel-in-progress: ${spec.schedule.concurrency.cancelInProgress}

jobs:
  loop:
    runs-on: ubuntu-latest
    timeout-minutes: ${spec.schedule.timeoutMinutes}
    permissions:
      contents: read
      pull-requests: write
      issues: write
      actions: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Validate loop spec
        run: npx -y -p @sheepxux/loop-engineering loopctl validate ${loopDir}/loop.yaml
      - name: Check budgets and carryover work
        id: next
        run: |
          # next exits non-zero when the loop should not run; that is a skip, not a failure.
          (npx -y -p @sheepxux/loop-engineering loopctl next ${loopDir} || true) | tee next.json
          echo "ok=$(node -p 'JSON.parse(require("fs").readFileSync("next.json","utf8")).ok')" >> "$GITHUB_OUTPUT"
          {
            echo '### loopctl next'
            echo '\`\`\`json'
            cat next.json
            echo '\`\`\`'
          } >> "$GITHUB_STEP_SUMMARY"
      - name: Run one loop iteration
        if: steps.next.outputs.ok == 'true'
        run: |
          # Replace this step with your agent invocation. The agent should follow
          # the rendered executor skill for this loop and finish by running:
          #   loopctl record ${loopDir} --run <run-log.json>
          #
          # Examples:
          #   codex exec "Run one iteration of the ${spec.metadata.name} loop per ${loopDir}/loop.yaml"
          #   claude -p "Run one iteration of the ${spec.metadata.name} loop per ${loopDir}/loop.yaml"
          echo "No agent configured yet. See the rendered adapter files for ${spec.metadata.name}."
      - name: Skip (budget or gate)
        if: steps.next.outputs.ok != 'true'
        run: echo "loopctl next reported ok=false; skipping this run. See the step summary."

# To let the agent commit updated loop state back to the repository, change
# permissions.contents to write and push from the run step on a branch.
`;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
