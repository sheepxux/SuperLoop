# v1 Release Checklist

## Skill and plugins

- `loopctl skill validate skills/loop-engineering` passes with no warnings.
- Official Skill quick validation and `gh skill publish --dry-run` pass.
- `agents/openai.yaml` matches the Skill and its default prompt names `$loop-engineering`.
- Codex and Claude plugin manifests validate and report the same semver as `package.json`.
- Codex/Claude installation into clean temporary homes succeeds, and each platform's plugin list reports the plugin enabled rather than merely installed.
- Trigger, hard-negative, safety, and degradation evals pass in fresh sessions.

## Runtime and protocol

- `npm run smoke` passes on every supported Node version.
- Examples validate and execute at least one dry-run.
- Passing results require digest-bound independent evaluator artifacts.
- Empty success, status/verdict mismatch, duplicate/unknown items, path traversal, approval tampering, and budget bypass tests fail closed.
- Matched benchmark cases are mechanically rescored.
- Strategy promotion archives both versions; rollback test passes.
- Generated GitHub Actions output remains manual, read-only, and explicitly labeled scaffold.

## Package

- `npm pack --dry-run` contains canonical Skill, evals, assets, schemas, binaries, and both plugin manifests.
- Install the generated tarball in an empty directory and run `loopctl --help`, `loopctl doctor`, Skill install, initialization, validation, and one dry-run.
- `npm publish --dry-run` passes.
- `@sheepxux/loop-engineering@1.0.1` is visible before documenting npm as available.

## Version and GitHub

- `package.json`, lockfile, Codex plugin, Claude plugin, marketplace metadata, README files, and schema `$id` URLs all say `1.0.1`.
- Create annotated tag `v1.0.1` only from the tested `main` commit.
- Every raw schema URL under the tag returns 200.
- Create a GitHub Release with accurate capabilities, boundaries, upgrade notes, and install commands.
- CI for the tag and `main` passes.

## Public claims

- Describe the product as a complete Agent Skill plus a local reference runtime.
- Describe “evolution” as benchmark-gated external task-strategy optimization.
- Do not claim model self-training, guaranteed monotonic improvement, production sandboxing, provider-native execution, or an operational GitHub Actions agent.
