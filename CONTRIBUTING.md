# Contributing

Loop-Engineering is built around one rule: portable loop specs should be safer and clearer than ad hoc agent prompts.

## Development

```bash
npm install
npm run smoke
```

Before opening a pull request:

- Add or update an example when changing protocol behavior.
- Add tests for validator or renderer changes.
- Run `npm run smoke`.
- Keep adapters thin; protocol semantics belong in `protocol/` and `src/validation.js`.

## Design Rules

- Prefer deterministic discovery before LLM ranking.
- Keep generator and evaluator roles independent.
- Persist state outside chat.
- Require budgets, retries, and human-only gates for risky actions.
- Do not add auto-merge or auto-deploy defaults.
