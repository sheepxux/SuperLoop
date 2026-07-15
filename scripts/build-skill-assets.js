#!/usr/bin/env node

import path from "node:path";
import { copyFile, repoRoot } from "../src/fs-utils.js";

const names = [
  "proposal.yaml",
  "proposal-decision.json",
  "loop.yaml",
  "state.json",
  "evaluator-result.json",
  "goal-evaluation.json",
  "run-log.json",
  "strategy.json",
  "experiment.json",
  "approval.json",
  "decision.json"
];

for (const name of names) {
  const source = path.join(repoRoot, "skills", "loop-engineering", "assets", name);
  const target = path.join(repoRoot, "templates", name);
  copyFile(source, target);
  console.log(`Wrote templates/${name}`);
}
