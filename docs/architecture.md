# Loop-Engineering Architecture

## 1. Purpose

Design a `loop-engineering` Codex Skill that helps Codex design, scaffold, review, and iterate recurring AI-agent workflows.

The Skill should be useful because it converts a vague automation request into a concrete loop design with:

- A discovery source.
- Isolated task handoff.
- Independent verification.
- Persistent state outside the chat.
- A scheduler or runtime plan.
- Budget, retry, and human-review limits.

The Skill should not pretend to be a daemon. A Skill can guide Codex and scaffold files, but actual recurring execution requires a runtime such as Codex automations, GitHub Actions, cron, cloud runners, or another scheduler.

## 2. Design Principle

The Skill should encode procedure, not hype.

Good output from this Skill is not "use agents in a loop." Good output is a reviewed loop specification that another engineer can run, audit, pause, and improve.

The Skill is useful only if it prevents the common failure modes:

- The loop runs without a clear stopping condition.
- The generator judges its own work.
- State lives only in chat context.
- Every decision is delegated to an LLM.
- The loop has no budget, retry, or escalation cap.
- The scheduler keeps retrying a broken task overnight.
- Human approval is missing for risky writes, merges, deploys, or external messages.

## 3. Target Users

Primary users:

- Engineers who want recurring AI help on repository maintenance, CI triage, issue cleanup, dependency updates, documentation drift, test failure analysis, or release hygiene.
- Teams that want to standardize how agentic workflows are designed before letting them run unattended.

Secondary users:

- Product or ops users who want periodic inbox triage, document synchronization, research monitoring, or report generation.

The initial scope focuses on software engineering loops, where repositories, git, tests, and browser verification provide concrete evidence.

## 4. Non-Goals

The Skill should not:

- Run forever by itself.
- Hide execution behind vague "agent magic."
- Auto-merge code.
- Auto-deploy production changes.
- Send external messages without an explicit approval boundary.
- Replace domain-specific skills such as GitHub, CI-fixing, frontend testing, or security review.

Instead, it should call or compose those skills when the loop design requires them.

## 5. Skill Trigger Contract

Proposed Skill name:

```yaml
name: loop-engineering
description: Design, scaffold, and review recurring AI-agent workflows that discover work, hand tasks to isolated workers, verify results with independent evaluators, persist state, and run on a schedule. Use when the user asks to automate repeated engineering or operational tasks with agents, build a loop, create an unattended or scheduled workflow, design generator/evaluator agent systems, add stateful recurring triage, or convert a manual prompt workflow into a durable loop.
```

Do not trigger this Skill for:

- One-shot coding tasks.
- Ordinary prompt-writing advice.
- Simple shell scripts that do not need agentic judgment.
- Workflows where a deterministic script is clearly enough.

## 6. Usefulness Bar

Every Skill run should produce at least one of these artifacts:

- A loop suitability assessment.
- A `loop-spec.yaml`.
- A repository file layout for loop state and run logs.
- A generator/evaluator separation plan.
- A scheduler plan or scaffold.
- A validation checklist.
- A risk and budget policy.
- An implementation diff when the user asks Codex to build the loop.

If Codex cannot produce at least one concrete artifact, the Skill is not doing useful work.

## 7. Skill Package Architecture

Recommended package:

```text
loop-engineering/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── loop-patterns.md
│   ├── evaluator-design.md
│   ├── runtime-integrations.md
│   ├── state-and-budget-policy.md
│   └── safety-boundaries.md
├── scripts/
│   ├── validate_loop_spec.py
│   ├── init_loop_state.py
│   └── render_github_action.py
└── assets/
    └── templates/
        ├── loop-spec.yaml
        ├── loop-state.json
        ├── worker-prompt.md
        ├── evaluator-prompt.md
        └── github-action.yml
```

Keep `SKILL.md` short. It should route the task and enforce the core workflow. Put examples, runtime details, and templates in references/assets.

## 8. Progressive Disclosure

`SKILL.md` should include only:

- Suitability gate.
- The five loop actions.
- Required output contract.
- When to read each reference file.
- When to run each script.

Reference loading:

- Read `loop-patterns.md` when choosing a loop pattern.
- Read `evaluator-design.md` when the loop changes code, UI, tests, data, or external state.
- Read `runtime-integrations.md` when the user wants scheduled execution.
- Read `state-and-budget-policy.md` when defining persistence, retries, token limits, or run limits.
- Read `safety-boundaries.md` when the loop can write, merge, deploy, purchase, message users, or modify production systems.

This keeps the default Skill cheap while still allowing deep guidance for serious loops.

## 9. Core Workflow

The Skill should force Codex through this sequence.

### 9.1 Suitability Gate

Classify the request:

- `one-shot`: Do the task directly; do not design a loop.
- `scriptable`: Recommend a deterministic script first.
- `agentic-loop`: Continue with loop design.
- `unsafe-loop`: Require human approval gates or reject unattended execution.

Use an agentic loop only when the task requires recurring judgment, changing context, or multi-step remediation.

### 9.2 Define Objective and Stop Conditions

Write a plain objective and hard stop conditions:

- What state counts as done?
- What state counts as blocked?
- What state counts as unsafe?
- What should be carried into the next run?

No loop should be created without explicit stop and blocked states.

### 9.3 Design Discovery

Define how the loop finds work:

- CI failures.
- GitHub issues or PRs.
- Logs or alerts.
- Dependency advisories.
- Stale documentation.
- User inbox or queue.
- Local repository changes.

Prefer deterministic collection before LLM ranking. The model should judge a bounded list, not search the world freely unless that is the product requirement.

### 9.4 Design Handoff

Each discovered task should become an isolated work item:

- Separate git worktree or branch when code is changed.
- Separate run directory for logs.
- Separate worker prompt.
- Explicit permissions.
- Explicit expected output.

The handoff should contain enough context for a worker agent without leaking evaluator conclusions.

### 9.5 Design Verification

The evaluator must be independent from the generator.

Default evaluator stance:

> Assume the result is wrong until tests, inspection, and evidence prove otherwise.

Verification should use real tools whenever available:

- Unit tests.
- Type checks.
- Linters.
- Build commands.
- Playwright for UI.
- Screenshots and DOM checks.
- Static analysis.
- Security checks.
- Diff review.

The evaluator should be allowed to reject with reasons. The generator should not decide whether its own work is good enough.

### 9.6 Design Persistence

State must live outside the conversation:

```text
.loop-engineering/loops/<loop-name>/
├── loop-spec.yaml
├── state.json
├── inbox.md
├── decisions.md
└── runs/
    └── 2026-07-09T090000Z/
        ├── discovery.json
        ├── handoff.md
        ├── worker-result.md
        ├── evaluator-result.md
        └── summary.md
```

Persist:

- Last successful run.
- Open tasks.
- Blocked tasks.
- Human decisions.
- Retry count.
- Budget consumed.
- Links to PRs, issues, logs, or artifacts.

### 9.7 Design Scheduling

Choose the runtime:

- Codex automation for Codex-native reminders or recurring checks.
- GitHub Actions for repository-centric loops.
- cron for local or server tasks.
- Cloud scheduler for always-on execution.
- Manual command for early MVP.

Every schedule must include:

- Cadence.
- Time zone.
- Maximum runtime.
- Maximum retries.
- Daily or weekly budget.
- Escalation target.

### 9.8 Define Human Review

Explicitly mark actions as:

- `auto-allowed`: Safe, reversible, low-risk.
- `needs-review`: PR creation, issue comment, non-critical file changes.
- `human-only`: merge, deploy, delete data, send external messages, spend money, change permissions.

The Skill should push risky operations into human approval instead of pretending the evaluator solves governance.

## 10. Loop Spec Schema

The central artifact should be `loop-spec.yaml`.

Minimum schema:

```yaml
name: ci-failure-triage
owner: engineering
objective: "Find new CI failures, identify likely causes, draft fixes, and open reviewed PRs."
cadence:
  runtime: github-actions
  schedule: "0 9 * * 1-5"
  timezone: "Asia/Shanghai"
discovery:
  sources:
    - type: github-actions
      repository: owner/repo
      filter: "failed runs from last 24h"
  ranking:
    deterministic_first: true
    max_items_per_run: 5
handoff:
  isolation: git-worktree
  branch_prefix: "loop-engineering/ci-failure-triage"
  worker_prompt_template: assets/templates/worker-prompt.md
verification:
  evaluator: independent-agent
  default_stance: "assume-broken"
  required_tools:
    - test-command
    - diff-review
  commands:
    - "npm test"
    - "npm run typecheck"
persistence:
  state_path: ".loop-engineering/loops/ci-failure-triage/state.json"
  run_log_dir: ".loop-engineering/loops/ci-failure-triage/runs"
human_review:
  auto_allowed:
    - "create local branch"
    - "run tests"
  needs_review:
    - "open pull request"
  human_only:
    - "merge pull request"
    - "deploy production"
budgets:
  max_items_per_run: 5
  max_retries_per_item: 2
  max_runtime_minutes: 45
  max_daily_runs: 2
failure_policy:
  on_repeated_failure: "move to inbox.md with evidence"
  on_budget_exceeded: "stop and summarize"
outputs:
  - pull_request
  - inbox_update
  - run_summary
```

`validate_loop_spec.py` should reject specs that lack verification, persistence, budget caps, or human-review boundaries.

## 11. Reference Design

### 11.1 `loop-patterns.md`

Include reusable patterns:

- Morning triage loop.
- CI failure repair loop.
- Dependency update loop.
- Issue deduplication loop.
- Documentation drift loop.
- Frontend visual regression loop.
- Data quality monitoring loop.

Each pattern should specify:

- Discovery source.
- Worker role.
- Evaluator role.
- Required tools.
- State files.
- Risk level.
- Human gate.

### 11.2 `evaluator-design.md`

Include evaluator rules:

- Use a fresh context.
- Do not pass generator rationale unless needed as evidence.
- Prefer executable checks over code reading.
- Require screenshots for frontend changes.
- Require failing-before/passing-after evidence for bug fixes when possible.
- Reject vague success claims.
- Produce structured verdicts: `pass`, `fail`, `blocked`, `needs-human`.

### 11.3 `runtime-integrations.md`

Describe how to map the loop spec to:

- GitHub Actions.
- Codex automations.
- cron.
- Cloud runners.

Each runtime section should list supported capabilities, missing capabilities, and safe defaults.

### 11.4 `state-and-budget-policy.md`

Define:

- State file schema.
- Run log structure.
- Retry accounting.
- Token and runtime budgets.
- Stale task cleanup.
- Escalation to inbox.

### 11.5 `safety-boundaries.md`

Define risk categories:

- Local-only read operations.
- Local file writes.
- Repository writes.
- External system writes.
- Production changes.
- Financial or permission changes.

Require human-only gates for high-risk categories.

## 12. Script Design

### 12.1 `validate_loop_spec.py`

Purpose:

- Parse YAML.
- Validate required sections.
- Enforce verification and budget fields.
- Fail if generator and evaluator are the same role.
- Fail if scheduled loop lacks persistence.
- Fail if risky actions lack human gates.

This is the most important script because it makes the Skill more than advice.

### 12.2 `init_loop_state.py`

Purpose:

- Create `.loop-engineering/loops/<loop-name>/`.
- Initialize `state.json`, `inbox.md`, `decisions.md`, and `runs/`.
- Refuse to overwrite existing loop state unless explicitly requested.

### 12.3 `render_github_action.py`

Purpose:

- Convert a valid `loop-spec.yaml` into a conservative GitHub Actions workflow.
- Include schedule, timeout, concurrency, and artifact upload.
- Default to opening artifacts or PR drafts, not merging.

## 13. Output Modes

The Skill should support four modes.

### 13.1 Advisory Mode

User asks whether a loop is appropriate.

Output:

- Suitability assessment.
- Recommended loop pattern.
- Risks and non-goals.

### 13.2 Design Mode

User asks to design a loop.

Output:

- `loop-spec.yaml`.
- State layout.
- Verification plan.
- Runtime recommendation.

### 13.3 Scaffold Mode

User asks to build the loop in a repo.

Output:

- Files created under `.loop-engineering/loops/<loop-name>/`.
- Optional GitHub Actions workflow.
- Validation result from `validate_loop_spec.py`.

### 13.4 Review Mode

User asks to review an existing loop.

Output:

- Findings first.
- Missing verification, persistence, budgets, isolation, or gates.
- Concrete patch recommendations.

## 14. Quality Gates

Before finalizing any loop design, Codex must check:

- Is this actually recurring?
- Is an LLM necessary?
- Are discovery inputs bounded?
- Is handoff isolated?
- Is verification independent?
- Does verification run real tools?
- Is state persisted outside chat?
- Is there a scheduler or explicit manual run command?
- Are budgets and retries capped?
- Are risky actions gated by humans?
- Is there an inbox path for blocked work?

Any `no` answer must be either fixed or documented as a deliberate limitation.

## 15. Example User Requests

The Skill should trigger on requests like:

- "Turn my weekly dependency cleanup into an agent loop."
- "Design a loop that checks failed CI every morning and drafts fixes."
- "Make a Codex loop that scans open issues and creates PRs for easy bugs."
- "I want an evaluator agent to review generated frontend work with Playwright."
- "Review this agent workflow before I schedule it."
- "Convert this recurring prompt into a durable automation."

It should not trigger on:

- "Fix this test."
- "Write a better prompt."
- "Summarize this article."
- "Create a simple cron script that deletes temp files."

## 16. v0.1.0 Implementation

The current release includes:

- Versioned JSON Schemas under `protocol/`.
- `loopctl validate`, `init`, `render`, `next`, `record`, `check`, `schema`, and `doctor`.
- Stateful templates and three validated example loops.
- Executor and advisor adapters generated from one source.
- A GitHub Actions renderer that validates the spec and gates execution on `loopctl next`.
- Runtime, validation, renderer, and publish-readiness tests.

Deferred beyond v0.1.0:

- The long-running `loopd` Runner.
- Direct provider execution inside the Runner.
- A hosted control plane.

v0.1.0 is useful if it reliably produces safe, reviewable loop specs, rejects underspecified or unsafe contracts, and records bounded runs consistently.

## 17. Validation Strategy

Test the Skill with realistic tasks:

1. CI failure triage loop.
2. Dependency update loop.
3. Documentation drift loop.
4. Frontend visual QA loop.
5. Unsafe request: "auto-merge any PR the evaluator likes."

Expected behavior:

- For the first four, produce specs with discovery, handoff, verification, persistence, scheduling, and budgets.
- For the unsafe request, require human review for merge and deploy.

Forward-testing should use fresh agents with only the Skill and the test request, not this architecture document's conclusions.

## 18. Success Metrics

The Skill is working if:

- It produces fewer vague automation plans.
- It consistently separates generator and evaluator roles.
- It catches missing persistence and budget caps.
- It routes high-risk actions to human review.
- It creates loop specs that are understandable without chat history.
- Another Codex instance can implement the loop from the spec.

The Skill is failing if:

- It mostly restates the five Loop Engineering steps.
- It lets the generator self-approve.
- It produces scheduler plans with no state.
- It encourages unattended write actions without gates.
- Its outputs cannot be validated mechanically.

## 19. Recommended Next Implementation

Keep v0.1.x focused on the protocol and mechanical state transitions. The next implementation step is the local file-based Runner described in [runner-design.md](runner-design.md): leases, due checks, event logs, runtime budget enforcement, and pause/resume controls.

Do not start with a hosted control plane. A local Runner is easier to trust, test, and explain, and it preserves the same portable contract used by every adapter.
