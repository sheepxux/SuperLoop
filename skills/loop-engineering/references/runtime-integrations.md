# Runtime and Platform Integrations

## Runtime choice

Use the least powerful runtime that meets the need:

1. manual `loopctl` run for design and early validation;
2. local `loopd` for durable polling and leases;
3. repository CI for repository-scoped collection/scaffolding;
4. provider-native automation or a cloud scheduler for always-on operation.

For the bundled synchronous command Runner, keep the command in the foreground and do not leave background child processes. It renews the lease before commit but does not provide in-flight async heartbeats or process-group isolation.

Do not schedule a loop until a manual run has completed with valid evidence.

## Canonical Skill versus loop instance

The installed `loop-engineering` Skill assesses, designs, operates, reviews, and evolves loops. A rendered loop-instance Skill contains the specific `loop.yaml` contract and one-iteration executor instructions. Do not overwrite the canonical Skill with an instance.

Codex project instances belong under `.agents/skills/<loop-name>/`. Claude Code project instances belong under `.claude/skills/<loop-name>/`.

Initialize a proposal-compiled contract with the exact approved name and root:

```bash
LOOP_NAME="<exact loop.yaml metadata.name>"
loopctl init "$LOOP_NAME" --from loop.yaml --out .loop-engineering/loops
```

The approved paths remain `.loop-engineering/loops/<name>/{state.json,runs/,inbox.md,decisions.md}`. `init` must fail instead of renaming a provenance-bound contract or relocating its state; change those fields through a new proposal revision and human approval.

## Local Runner

Use:

```bash
loopd start --once --root .loop-engineering/loops --loop <name>
loopctl status --root .loop-engineering/loops
loopctl runs .loop-engineering/loops/<name>
loopctl pause .loop-engineering/loops/<name> --reason "..."
loopctl resume .loop-engineering/loops/<name>
```

The dry-run executor tests scheduling and persistence only. A command executor is disabled unless the operator passes `--allow-command`; that flag does not override user authority or human gates. The Runner owns and overwrites command-run start/finish timestamps, exposes `LOOP_STARTED_AT`, and freezes active strategy version/SHA bindings before execution. A command cannot backdate work into another accounting day. `budget-exceeded` records are accounting-only and never mutate task results.

## GitHub Actions

Treat rendered Actions output as a scaffold unless it defines a real executor, least-privilege permissions, secret handling, and a durable state channel. Never claim `echo` placeholders are operational automation.

## Installation

Prefer versioned plugin or `gh skill` installation for public use. From a source checkout or npm package, use `loopctl skill install <codex|claude-code> --scope <project|user>`. Validate the installed copy after installation.

Pin public installation examples to a release tag. Do not rely on an unpublished or floating npm package.

## Upgrade an existing loop

For a v1.0.1 loop, stop `loopd`, confirm that no active lease remains, back up the loop directory, and run:

```bash
loopctl migrate <loop-dir>
loopctl validate <loop-dir>/loop.yaml
loopctl next <loop-dir>
```

Migration binds state and leases to the loop generation and exact contract digest, and requires a complete continuous `v1..active` strategy archive chain. Re-running it on an already migrated consistent loop is a verified no-op and never clears a current pending experiment. A legacy pending experiment is marked `invalidated`; rebuild it with a new ID and v1.0.2 per-case attestations, and discard its old approval.

An expired same-host lease is retired automatically only when its PID is provably dead. For a remote or unverifiable owner, inspect it first and then explicitly use `--retire-expired-lease`; live, unexpired, or malformed leases still fail closed. Treat any migration failure as an integrity finding and never hand-edit state to bypass it.
