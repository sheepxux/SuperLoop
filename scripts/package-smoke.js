#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-package-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  const packed = JSON.parse(run(npm, ["pack", "--json", "--pack-destination", temporary], root));
  const tarball = path.join(temporary, packed[0].filename);
  const project = path.join(temporary, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "package.json"), '{"name":"package-smoke","private":true}\n');
  run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], project);

  const binary = (name) => path.join(
    project,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.cmd` : name
  );
  run(binary("loopctl"), ["--help"], project);
  run(binary("loopctl"), ["doctor"], project);
  run(binary("loopctl"), ["skill", "validate"], project);
  run(binary("loopctl"), ["skill", "install", "both", "--scope", "project"], project);
  run(binary("loopctl"), ["skill", "validate", ".agents/skills/loop-engineering"], project);
  run(binary("loopctl"), ["skill", "validate", ".claude/skills/loop-engineering"], project);
  run(binary("loopctl"), ["init", "package-smoke", "--out", ".loop-engineering/loops"], project);
  run(binary("loopctl"), ["next", ".loop-engineering/loops/package-smoke"], project);
  run(binary("loopd"), ["start", "--once", "--loop", "package-smoke"], project);

  const cache = path.join(temporary, "codex-cache");
  copyWithoutDependencies(root, cache);
  const helper = path.join(cache, "skills", "loop-engineering", "scripts", "run-loopctl.mjs");
  run(process.execPath, [helper, "doctor"], project, {
    ...process.env,
    LOOP_ENGINEERING_RUNTIME_PACKAGE: tarball
  });

  const staleProject = path.join(temporary, "stale-project");
  fs.mkdirSync(staleProject, { recursive: true });
  fs.writeFileSync(path.join(staleProject, "package.json"), '{"name":"stale-runtime-smoke","private":true}\n');
  run(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], staleProject);
  const staleManifestPath = path.join(
    staleProject,
    "node_modules",
    "@sheepxux",
    "loop-engineering",
    "package.json"
  );
  const staleManifest = JSON.parse(fs.readFileSync(staleManifestPath, "utf8"));
  staleManifest.version = "1.0.1";
  fs.writeFileSync(staleManifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(staleProject, "node_modules", "@sheepxux", "loop-engineering", "bin", "loopctl.js"),
    'process.stderr.write("stale 1.0.1 runtime was executed\\n"); process.exit(86);\n'
  );

  const fallbackOutput = run(process.execPath, [helper, "doctor"], staleProject, {
    ...process.env,
    LOOP_ENGINEERING_RUNTIME_PACKAGE: tarball
  });
  if (!fallbackOutput.includes("Codex plugin version matches package version 1.0.2")) {
    throw new Error("Runtime helper did not fall back from stale 1.0.1 to the current 1.0.2 tarball.");
  }
  console.log(`Package smoke passed: ${packed[0].filename}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function run(command, args, cwd, env = process.env) {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function copyWithoutDependencies(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    filter: (candidate) => {
      const relative = path.relative(source, candidate);
      return relative !== "node_modules"
        && !relative.startsWith(`node_modules${path.sep}`)
        && relative !== ".git"
        && !relative.startsWith(`.git${path.sep}`);
    }
  });
}
