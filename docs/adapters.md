# Adapters and Skill Distribution

## Canonical Skill

`skills/loop-engineering/` is the only product Skill source. Codex and Claude Code plugins both load that directory. Do not maintain separate platform copies of its instructions.

Install it with a versioned plugin/Skill command, or use:

```bash
loopctl skill install <codex|claude-code|both> --scope <project|user>
```

## Loop-instance renderers

Rendered instance Skills are intentionally different from the product Skill: they bind one validated `loop.yaml` to one-iteration executor instructions.

- `codex`: writes `.agents/skills/<loop-name>/` with `SKILL.md`, `loop.yaml`, worker/evaluator prompts, and Codex UI metadata.
- `claude-code`: writes `.claude/skills/<loop-name>/` and worker/evaluator agents under `.claude/agents/`.
- `chatgpt`: writes advisory instructions for design and evidence review; actual tool capability must be checked at runtime.
- `openclaw`: writes a loop contract plus worker/evaluator prompts.
- `generic-harness`: writes a portable file/command execution contract.
- `github-actions-scaffold`: writes a manual, read-only preflight workflow. It is not a scheduled agent executor.

## Invariants

- Render only a schema-valid loop.
- Never overwrite the canonical `loop-engineering` Skill with an instance.
- Keep worker and evaluator contexts separate.
- Treat generated commands as untrusted until inspected.
- Pin public runtime installation to the GitHub `v1.1.0` tag; npm is an optional second distribution channel.
- Do not schedule the GitHub Actions scaffold until a trusted executor, durable state channel, least-privilege permissions, and secret policy are added.
