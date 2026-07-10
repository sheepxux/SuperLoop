# Adapters

Adapters are intentionally thin. They translate `loop.yaml` into files a specific agent or runtime can consume.

All executor skill content comes from one source, `src/skill-content.js`. The static files under `adapters/` are the generic (spec-less) versions of the same playbook, regenerated with `npm run build:adapters` and checked by `loopctl doctor`. Rendered files inline values from the spec for convenience, but always declare `loop.yaml` as the winner on conflict — re-render after editing a spec.

## Adapters Supported in v0.1.x

- `codex`: renders a Codex-compatible `SKILL.md` (executor playbook), loop spec, worker prompt, and evaluator prompt.
- `claude-code`: renders `.claude/skills/<loop>/SKILL.md` plus worker/evaluator subagent prompts under `.claude/agents/`.
- `chatgpt`: renders advisor instructions. ChatGPT has no repository or filesystem access, so this adapter deliberately does not pretend to execute the loop; it designs and reviews specs, reviews run evidence, and assists the human at review gates.
- `openclaw`: renders OpenClaw loop instructions (executor playbook).
- `generic-harness`: renders a plain file-and-command contract (executor playbook).
- `github-actions`: renders a scheduled workflow that validates the spec, gates the run on `loopctl next`, publishes the plan to the step summary, and leaves one clearly marked step for the agent invocation.

## Executor vs Advisor

Executor adapters (codex, claude-code, openclaw, generic-harness) receive the full operational playbook: preflight with `loopctl validate` + `loopctl next`, bounded discovery with concrete commands, worktree handoff, independent evaluation checked by `loopctl check evaluator`, and persistence through `loopctl record`. Advisor adapters (chatgpt) receive the review-side contract only.

## Adapter Rule

If behavior affects safety, verification, persistence, or budgets, keep it in the protocol, validator, or `loopctl` runtime commands. Do not hide it in one adapter.
