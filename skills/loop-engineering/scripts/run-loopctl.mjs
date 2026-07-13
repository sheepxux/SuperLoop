#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "../../..");
const pinnedFallbackPackage = "github:sheepxux/Loop-Engineering#v1.0.2";
const expectedRuntimeVersion = pinnedFallbackPackage.split("#v").at(-1);
const candidates = [
  path.join(packageRoot, "bin", "loopctl.js"),
  path.join(process.cwd(), "node_modules", "@sheepxux", "loop-engineering", "bin", "loopctl.js")
];

for (const candidate of candidates) {
  const root = path.resolve(path.dirname(candidate), "..");
  if (fs.existsSync(candidate) && isLoopEngineeringRuntime(root)) {
    process.exit(run(process.execPath, [candidate, ...process.argv.slice(2)]));
  }
}

const fallbackPackage = process.env.LOOP_ENGINEERING_RUNTIME_PACKAGE
  || pinnedFallbackPackage;
if (!process.env.LOOP_ENGINEERING_RUNTIME_PACKAGE) {
  const installed = findCompatiblePathRuntime();
  if (installed) {
    process.exit(run(installed, process.argv.slice(2)));
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
console.error(`Local Loop-Engineering runtime not found; using ${fallbackPackage}.`);
const fallback = spawnSync(npm, [
  "exec",
  "--yes",
  `--package=${fallbackPackage}`,
  "--",
  "loopctl",
  ...process.argv.slice(2)
], { stdio: "inherit" });
if (!fallback.error) process.exit(fallback.status ?? 1);

console.error("Loop-Engineering runtime could not be started.");
console.error(`npm exec --yes --package=${pinnedFallbackPackage} -- loopctl <command>`);
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

function isLoopEngineeringRuntime(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return manifest.name === "@sheepxux/loop-engineering"
      && manifest.version === expectedRuntimeVersion
      && fs.existsSync(path.join(root, "node_modules", "yaml", "package.json"))
      && fs.existsSync(path.join(root, "node_modules", "ajv", "package.json"));
  } catch {
    return false;
  }
}

function findCompatiblePathRuntime() {
  const names = process.platform === "win32"
    ? ["loopctl.cmd", "loopctl.exe", "loopctl"]
    : ["loopctl"];
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    for (const name of names) {
      const executable = path.resolve(directory || process.cwd(), name);
      try {
        const resolved = fs.realpathSync(executable);
        const root = path.resolve(path.dirname(resolved), "..");
        if (isLoopEngineeringRuntime(root)) return executable;
      } catch {
        // Ignore missing executables and wrappers that cannot prove their package identity.
      }
    }
  }
  return null;
}
