# Strategy Evolution

Strategy evolution changes external task instructions, not model weights and not the safety contract.

## Preconditions

Require:

- a stable objective and immutable `loop.yaml`;
- one named metric with direction and minimum improvement;
- a fixed benchmark manifest with stable case IDs;
- the same eligible cases for baseline and candidate;
- an evaluator independent from the worker and strategy author;
- enough samples for both arms;
- retained strategies and raw evidence for rollback and audit.

Do not evolve when the metric is missing, the benchmark changed between arms, or the candidate needs weaker verification to appear better.

## Trigger and strategy binding

Stage a new experiment only when the runtime reports that `evolution.trigger.afterRuns` or `evolution.trigger.consecutiveFailures` is due. Keep at most one pending experiment. Bind every attributable run, benchmark arm, and case evaluation to the exact active strategy version and SHA-256; evidence from a prior strategy cannot justify promotion of the current one.

After migrating a v1.0.1 loop, the old pending record is marked `invalidated`. Rebuild it under a new experiment ID with v1.0.2 per-case evaluator attestations. Never reuse its old approval.

## One experiment

1. Read the active strategy, recent runs, evaluator failures, and human decisions.
2. Form one falsifiable hypothesis.
3. Change only the strategy instructions.
4. Run baseline and candidate against identical case IDs.
5. Store per-case outputs, verdicts, evaluator identity, commands, exit codes, and artifact digests.
6. Recompute aggregate scores from the recorded cases.
7. Check the configured improvement threshold and safety invariants.
8. Reject mechanically, stage for review, or promote. A human-reviewed pending experiment must end in an immutable approval or rejection decision. Never self-approve or self-reject.

Use `assets/experiment.json` as the portable artifact shape and `loopctl evolve` for mechanical checks. If a human rejects a pending candidate, persist the decision instead of editing state:

```bash
loopctl experiment reject <loop-dir> --experiment <experiment.json> --actor <human> --reason "<decision>"
```

This writes the [decision artifact](../assets/decision.json), marks the experiment `abandoned`, clears the pending slot, and consumes the current trigger. Collect new attributable task runs before proposing another experiment.

## Approval integrity

Bind human approval to the exact staged experiment and candidate digest. Record approver, timestamp, baseline version, and reason. The staging time must follow all experiment evidence; approval must follow staging and evidence. Any candidate or evidence change invalidates approval. Bind rejection to the same digest with actor, time, and reason. Treat local identity strings as audit assertions, not authenticated identity; use an identity-backed external approval channel when governance must be enforceable.

## Promotion and rollback

Archive the prior and promoted strategies. Reset promotion counters only after both the strategy and state commit successfully. Resolve a pending experiment before rollback. Keep a manual rollback command available and require a reason. A later regression should create evidence for rollback; it must not silently rewrite history.

## Honest claims

Call this benchmark-gated task-strategy evolution. Do not claim autonomous model self-training, guaranteed monotonic improvement, or unlimited self-evolution.
