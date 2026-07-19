# Safety and Governance

## Risk classes

- **Low**: local reads, deterministic analysis, isolated draft artifacts.
- **Medium**: repository writes, branch creation, pull-request drafts, non-production configuration.
- **High**: merge, deployment, production data, money, external communication, credentials, access control, or legal/regulated decisions.

Automatic strategy promotion is acceptable only for explicitly low-risk loops. Medium and high risk require human review; high-risk external actions remain human-only.

## Gate model

- `autoAllowed`: reversible actions contained to the declared workspace.
- `needsReview`: durable drafts or changes a human must inspect before external effect.
- `humanOnly`: merge, deploy, delete, spend, send, publish, modify permissions, expose secrets, or override safety.

Do not infer permission for a broader action from permission to run a loop. Tool approval, repository access, and `--allow-command` are transport permissions, not governance approval.

## Credential boundary

Give unattended loops the minimum read/write scopes and no high-risk production credential where possible. Do not run untrusted repository commands with inherited secrets. Redact secrets from events, logs, summaries, and evaluator artifacts.

## Enforcement boundary

Schema validation, state checks, budgets, leases, and timeouts can be mechanical. Natural-language permissions and human gates are not an operating-system sandbox. State this boundary in designs and treat agent-enforced rules as absolute until a stronger sandbox exists.

## Fail closed

Stop when evidence is missing, a budget cannot be measured, evaluator independence cannot be established, state is inconsistent, approval does not match the candidate digest, or the requested action crosses a human-only boundary.
