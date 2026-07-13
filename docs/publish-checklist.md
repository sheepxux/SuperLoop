# v1 Release Checklist

## Skill and plugins

- `loopctl skill validate skills/loop-engineering` passes with no warnings.
- Official Skill quick validation and `gh skill publish --dry-run` pass.
- `agents/openai.yaml` matches the Skill and its default prompt names `$loop-engineering`.
- Codex and Claude plugin manifests validate and report the same semver as `package.json`.
- Codex/Claude installation into clean temporary homes succeeds, and each platform's plugin list reports the plugin enabled rather than merely installed.
- The canonical Skill runtime helper executes `doctor` from a clean Codex plugin cache with no bundled `node_modules`, using the pinned fallback rather than a partial local runtime.
- Trigger, hard-negative, safety, and degradation evals pass in isolated sessions.
- The results artifact covers every eval ID; each session has a SHA-256-bound reviewer record with an exact judgment for every expectation. Claims disclose that raw provider transcripts are not retained.

## Runtime and protocol

- `npm run smoke` passes on every supported Node version.
- Examples validate and execute at least one dry-run.
- Passing results require digest-bound independent evaluator artifacts.
- A v1.0.1 fixture receives generation/contract bindings and an exact continuous `v1..active` archive ledger; orphan/future archives, live/unknown lease owners, and broken parents fail closed. Repeating migration on a current pending loop is a no-op.
- A migrated pending experiment is marked `invalidated`, cannot reuse prior evidence/approval, and must use a new ID. A fresh experiment cannot bypass its trigger or coexist with another pending experiment.
- Empty success, status/verdict mismatch, duplicate/unknown or terminal items, real-path escape, evaluator impersonation, missing state, malformed leases, stale-lock races, approval-time tampering, partial transactions, concurrent state loss, accounting-date rollback, command backdating, and budget bypass tests fail closed.
- Matched benchmark cases are mechanically rescored and every arm/case binds its strategy digest.
- Human approval and rejection both bind the pending digest. Rejection leaves an immutable decision, consumes the trigger, and permits a later experiment only after fresh runs.
- Strategy promotion archives both versions; rollback passes and is blocked while review is pending.
- Generated GitHub Actions output remains manual, read-only, and explicitly labeled scaffold.

## Package

- `npm pack --dry-run` contains canonical Skill, evals, assets, schemas, binaries, and both plugin manifests.
- Install the generated tarball in an empty directory and run `loopctl --help`, `loopctl doctor`, Skill install, initialization, validation, and one dry-run.
- `npm publish --dry-run` passes.
- If the optional npm channel is published, `@sheepxux/loop-engineering@1.0.2` is visible before documenting it as available.

## Version and GitHub

- `package.json`, lockfile, Codex plugin, Claude plugin, marketplace metadata, README files, and schema `$id` URLs all say `1.0.2`.
- Create annotated tag `v1.0.2` only from the tested `main` commit.
- Every raw schema URL under the tag returns 200.
- Create a GitHub Release with accurate capabilities, boundaries, upgrade notes, and install commands.
- Wait for CI on the tag and `main` before publishing the GitHub Release.
- Main and `v*` tags have active protection rules; third-party actions in CI use immutable commit SHAs.

## Public claims

- Describe the product as a complete Agent Skill plus a local reference runtime.
- Describe “evolution” as benchmark-gated external task-strategy optimization.
- Do not claim model self-training, guaranteed monotonic improvement, production sandboxing, provider-native execution, or an operational GitHub Actions agent.
