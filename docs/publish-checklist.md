# SuperLoop v2 Release Checklist

## Skill and plugins

- `loopctl skill validate skills/superloop` passes with no warnings.
- Official Skill quick validation and `gh skill publish --dry-run` pass.
- `agents/openai.yaml` matches the Skill and its default prompt names `$superloop`.
- Codex and Claude plugin manifests validate and report the same semver as `package.json`.
- Codex/Claude installation into clean temporary homes succeeds, and each platform's plugin list reports the plugin enabled rather than merely installed.
- The canonical Skill runtime helper executes `doctor` from a clean Codex plugin cache with no bundled `node_modules`, using the pinned fallback rather than a partial local runtime.
- Trigger, hard-negative, safety, and degradation evidence is either freshly evaluated for v2 or explicitly labeled migration-review evidence; retained v1 outputs are never represented as fresh v2 provider sessions.
- Vague-idea evals prove intent preservation, at most three material questions, explicit assumptions, verifiable Goal criteria, honest readiness, and refusal to execute before confirmation.
- Finite/continuous routing evals prove that composite outcomes use one generic Work Plan, failed dependencies cannot be skipped, and open-ended monitors remain on bounded discovery instead of receiving a fake terminal plan.
- The results artifact covers every eval ID; each session has a SHA-256-bound reviewer record, exact per-expectation judgments, and a separately digest-bound raw assistant output. Claims disclose that provider transport logs and model identifiers are not retained.

## Runtime and protocol

- `npm run smoke` passes on every supported Node version.
- Examples validate and execute at least one dry-run.
- Passing results require digest-bound independent evaluator artifacts.
- A legacy v1 contract/state tree remains immutable migration evidence. A parent-linked, freshly approved proposal initializes a new v2 generation under `.superloop/loops`; prior passes, experiments, approvals, leases, and completion do not transfer automatically.
- Within one supported protocol generation, a fixture missing integrity anchors receives generation/contract bindings and an exact continuous `v1..active` archive ledger; orphan/future archives, live/unknown lease owners, and broken parents fail closed. Repeating migration on a current pending loop is a no-op.
- A migrated pending experiment is marked `invalidated`, cannot reuse prior evidence/approval, and must use a new ID. A fresh experiment cannot bypass its trigger or coexist with another pending experiment.
- Empty success, status/verdict mismatch, duplicate/unknown or terminal items, real-path escape, evaluator impersonation, missing state, malformed leases, stale-lock races, approval-time tampering, partial transactions, concurrent state loss, accounting-date rollback, command backdating, and budget bypass tests fail closed.
- Matched benchmark cases are mechanically rescored and every arm/case binds its strategy digest.
- Human approval and rejection both bind the pending digest. Rejection leaves an immutable decision, consumes the trigger, and permits a later experiment only after fresh runs.
- Strategy promotion archives both versions; rollback passes and is blocked while review is pending.
- Generated GitHub Actions output remains manual, read-only, and explicitly labeled scaffold.
- The shipped proposal starter remains intentionally `needs-input`; approval fails until assumptions are human-confirmed, prerequisites are verified, and blockers/readiness are reconciled.
- Proposal revision creation plus parent-aware validation, decision, and compilation pass; a missing, changed, or wrong parent for revision 2+ fails closed.
- Proposal validation, blocking-gap refusal, human decision binding, digest-tamper refusal, deterministic compilation, complete Goal Contract persistence, candidate/Goal/reconstructable-decision provenance, and compiled-loop validation all pass.
- Public examples cover continuous discovery, a deterministic non-loop alternative, and a domain-neutral finite-plan Proposal that stays non-executable until its blocking inputs are confirmed.
- Proposal-compiled initialization accepts only the exact approved `metadata.name` and `--out .superloop/loops`, preserves `.superloop/loops/<name>/{state.json,runs/,inbox.md,decisions.md}`, and rejects rename or relocation.
- A finite Work Plan initializes exactly its approved Parts, schedules only dependency-ready IDs, supports heterogeneous Part-specific evidence/command envelopes, binds every pass to the exact Part definition and real in-Loop artifact files with recomputed digests, retries failures without unlocking descendants, and requires a separately bound whole-Goal evaluation before the lifecycle can become `completed`.
- Generic finite examples use domain-neutral local/source/tool permissions and extensible typed evidence rather than depending on repository-specific capabilities; the product still ships one canonical Skill.
- Finite state is reconstructed from the complete immutable run/resolution ledger, so direct edits cannot reopen Parts, lower retry or Goal-attempt counters, clear unresolved attention, or forge completion.
- A failed whole-Goal evaluation traces every failed Goal criterion to affected root Parts and reopens only those Parts and their descendants; blocked/human states require audited Part/Goal resolution, exhausted and completed states fail closed, and completed plans are skipped before lease acquisition.
- A command executor cannot persist direct edits to frozen `state.json` or `loop.yaml`; the Runner restores the preflight sources, retains evidence, rejects the draft, and records failure.

## Package

- `npm pack --dry-run` contains canonical Skill, evals, assets, schemas, binaries, and both plugin manifests.
- Install the generated tarball in an empty directory and run `loopctl --help`, `loopctl doctor`, Skill install, initialization, validation, and one dry-run.
- `npm publish --dry-run` passes.
- If the optional npm channel is published, `@sheepxux/superloop@2.0.0` is visible before documenting it as available.

## Version and GitHub

- `package.json`, lockfile, Codex plugin, Claude plugin, marketplace metadata, README files, and schema `$id` URLs all say `2.0.0`.
- Create annotated tag `v2.0.0` only from the tested `main` commit.
- Every raw schema URL under the tag returns 200.
- Create a GitHub Release with accurate capabilities, boundaries, upgrade notes, and install commands.
- Wait for CI on the tag and `main` before publishing the GitHub Release.
- Main and `v*` tags have active protection rules; third-party actions in CI use immutable commit SHAs.

## Public claims

- Describe the product as a complete Agent Skill plus a local reference runtime.
- Describe Proposal as an AI-authored design artifact, not authorization or executable state.
- Describe direct `loop.yaml` authoring only as a user-supplied existing-contract or explicitly requested expert path, never an agent-selected shortcut for a new vague idea.
- Describe “evolution” as benchmark-gated external task-strategy optimization.
- Do not claim model self-training, guaranteed monotonic improvement, production sandboxing, provider-native execution, or an operational GitHub Actions agent.
