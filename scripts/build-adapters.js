#!/usr/bin/env node
import path from "node:path";
import { repoRoot, writeText } from "../src/fs-utils.js";
import { staticAdapterFiles } from "../src/skill-content.js";

for (const [relativePath, content] of staticAdapterFiles()) {
  writeText(path.join(repoRoot, relativePath), content);
  console.log(`Wrote ${relativePath}`);
}
