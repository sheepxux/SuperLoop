import path from "node:path";
import { writeText, writeYaml } from "./fs-utils.js";
import { chatgptSkill, evaluatorPrompt, executorSkill, workerPrompt } from "./skill-content.js";

export const RENDERERS = new Set([
  "codex",
  "claude-code",
  "chatgpt",
  "openclaw",
  "generic-harness",
  "github-actions-scaffold"
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
  if (adapter === "github-actions-scaffold") return renderGitHubActionsScaffold(spec, outDir);
}

function renderCodex(spec, outDir) {
  const skillDir = path.join(outDir, ".agents", "skills", spec.metadata.name);
  writeYaml(path.join(skillDir, "loop.yaml"), spec);
  writeText(path.join(skillDir, "SKILL.md"), executorSkill("codex", spec));
  writeYaml(path.join(skillDir, "agents", "openai.yaml"), {
    interface: {
      display_name: displayName(spec.metadata.name),
      short_description: boundedShortDescription(spec.metadata.name),
      default_prompt: `Use $${spec.metadata.name} to run one bounded, independently verified iteration.`
    }
  });
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

function renderGitHubActionsScaffold(spec, outDir) {
  const dir = path.join(outDir, ".github", "workflows");
  const file = path.join(dir, `${spec.metadata.name}.yml`);
  const loopDir = spec.persistence.statePath.replace(/\/state\.json$/, "");
  const specFile = path.join(outDir, loopDir, "loop.yaml");
  writeYaml(specFile, spec);
  writeText(file, githubActionScaffoldYaml(spec, loopDir));
  return [file, specFile];
}

function githubActionScaffoldYaml(spec, loopDir) {
  const quotedSpec = shellQuote(`${loopDir}/loop.yaml`);
  const quotedLoopDir = shellQuote(loopDir);
  return `# Loop-Engineering preflight scaffold. Add a real executor and durable state channel before scheduling.
name: ${yamlScalar(`${spec.metadata.name} preflight`)}

on:
  workflow_dispatch:

concurrency:
  group: ${yamlScalar(spec.schedule.concurrency.group)}
  cancel-in-progress: ${spec.schedule.concurrency.cancelInProgress}

permissions:
  contents: read

jobs:
  preflight:
    runs-on: ubuntu-latest
    timeout-minutes: ${spec.schedule.timeoutMinutes}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Validate loop spec
        run: npm exec --yes --package=github:sheepxux/Loop-Engineering#v1.0.1 -- loopctl validate ${quotedSpec}
      - name: Check budgets and carryover work
        id: next
        run: |
          # next exits non-zero when the loop should not run; that is a skip, not a failure.
          (npm exec --yes --package=github:sheepxux/Loop-Engineering#v1.0.1 -- loopctl next ${quotedLoopDir} || true) | tee next.json
          echo "ok=$(node -p 'JSON.parse(require("fs").readFileSync("next.json","utf8")).ok')" >> "$GITHUB_OUTPUT"
          {
            echo '### loopctl next'
            echo '\`\`\`json'
            cat next.json
            echo '\`\`\`'
          } >> "$GITHUB_STEP_SUMMARY"
      - name: Executor integration required
        if: steps.next.outputs.ok == 'true'
        run: |
          echo "This workflow intentionally performs preflight only."
          echo "Add a trusted executor and a durable state channel before enabling a schedule."
      - name: Skip (budget or gate)
        if: steps.next.outputs.ok != 'true'
        run: echo "loopctl next reported ok=false; skipping this run. See the step summary."

# Keep this workflow manually triggered until the executor, least-privilege
# permissions, secret handling, and state persistence have been reviewed.
`;
}

function displayName(name) {
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function boundedShortDescription(name) {
  const value = `Run the ${name} verified agent loop`;
  return value.length <= 64 ? value : `Run ${name.slice(0, 48)} safely`;
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
