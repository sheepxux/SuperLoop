# Publish Checklist

Before publishing to GitHub:

- `npm run smoke` passes.
- `npm pack --dry-run` contains only intended files.
- README quick start works from a fresh clone.
- Examples validate with `loopctl validate`.
- Generated Codex and Claude Code adapters contain worker and evaluator prompts.
- GitHub Actions renderer validates `loop.yaml`, not `state.json`.
- The Git tag matching `package.json` version exists so versioned schema `$id` URLs resolve.
- License, contributing, security, and code of conduct files exist.
- Early design notes live under `docs/`, not at the repository root.

Before publishing to npm:

- Confirm the npm account controls the `@sheepxux` scope.
- Confirm `@sheepxux/loop-engineering` is available.
- Confirm `package.json` repository URL points to `https://github.com/sheepxux/Loop-Engineering`.
- Confirm version number.
- Run `npm publish --dry-run`.
