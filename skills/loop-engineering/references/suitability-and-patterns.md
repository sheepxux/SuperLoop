# Suitability and Loop Patterns

## Decision gate

Use the smallest mechanism that can reliably reach the objective. Route before designing.

| Class | Evidence | Default response |
| --- | --- | --- |
| One-shot | fits one bounded execution and evaluation context | perform it directly |
| Deterministic | stable inputs and rules; no model judgment needed | build and test a script, job, query, or alert |
| Agentic loop | recurring judgment, or a finite composite outcome that needs durable independently verified Parts | create a non-executable proposal for review |
| Unsafe loop | irreversible or high-impact actions without a trustworthy approval boundary | add human gates, narrow authority, or refuse unattended operation |

Do not use vagueness as a fifth class. A vague idea may resolve to any row. Enter Propose mode only when a few material answers or explicit safe assumptions can produce a useful recommendation. Ask at most three questions; read [idea to loop](idea-to-loop.md) for the intake workflow.

An agentic loop candidate should have all of:

- a recurring or finite long-horizon observable outcome rather than “keep improving”;
- a bounded source of eligible work and a stable unit of work;
- evidence-bearing acceptance, stop, and blocked conditions;
- evidence an independent evaluator can inspect;
- state that survives the conversation;
- finite item, time, retry, and cost budgets;
- explicit human authority for irreversible or high-impact actions.

If one of these is unknowable, keep readiness at `needs-input`. If it is structurally impossible or unnecessary, route to a smaller mechanism or mark the proposal `not-applicable`.

## Questions worth asking

Ask only when the answer changes the design. High-value questions usually identify:

- the observable outcome and the artifact that proves it;
- whether the work is a continuous stream or a finite Work Plan, plus the eligible source or Part boundary;
- the actions the agent may draft versus the actions a human must authorize;
- the unavailable integration or credential that blocks verification.

Do not ask for preferences that can be represented as a reversible assumption. Never assume external authority merely to keep the workflow moving.

## Common patterns

### Triage

Collect bounded failures, alerts, or issues; rank deterministically; produce diagnoses or draft fixes. Keep notification and remediation as separate gates.

### Repair

Reproduce one defect, isolate work, implement the smallest patch, and independently verify it. Keep merge and deployment human-only.

### Drift detection

Compare generated or documented artifacts with a canonical source. Prefer deterministic diffing; use an agent only for ambiguous remediation.

### Research monitor

Poll stable sources, deduplicate findings, score relevance, and write a review queue. Require source traceability. Do not publish externally without approval.

### Finite composite project

Keep one Loop and one Goal Contract for the complete outcome. Define a fixed approved Work Plan with dependency-ready Parts, exact Part Gates, durable artifacts, and an independent final Goal Gate. Read [fixed work plans](work-plans.md). Do not call each Part a separate Loop.

### Strategy improvement

Repeat a task under a versioned strategy, collect objective outcomes, and test one candidate on matched cases. This is strategy optimization, not model training. Disable evolution when no stable external metric and frozen benchmark exist.

## Rejection and downgrade signals

Do not create an agentic loop when:

- one direct action can complete the request;
- stable rules can solve it without model judgment;
- success cannot be observed or evidenced;
- every run needs fresh human intent;
- discovery cannot be bounded;
- the only stopping rule is “the model will know”;
- required authority would exceed what the user granted;
- an independent evaluator or durable state cannot be provided.

Respond with the smaller alternative and its tradeoff. Do not emit proposal or loop artifacts for one-shot or deterministic routes.
