#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "../../..");
const candidates = [
  path.join(packageRoot, "bin", "loopctl.js"),
  path.join(process.cwd(), "node_modules", "@sheepxux", "loop-engineering", "bin", "loopctl.js")
];

for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    process.exit(run(process.execPath, [candidate, ...process.argv.slice(2)]));
  }
}

const executable = process.platform === "win32" ? "loopctl.cmd" : "loopctl";
const installed = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" });
if (!installed.error) {
  process.exit(installed.status ?? 1);
}

console.error("Loop-Engineering runtime not found.");
console.error("Run this script from the Loop-Engineering repository, or use the pinned GitHub v1.0.1 package.");
console.error("npm exec --yes --package=github:sheepxux/Loop-Engineering#v1.0.1 -- loopctl <command>");
console.error("Source: https://github.com/sheepxux/Loop-Engineering");
process.exit(127);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}
