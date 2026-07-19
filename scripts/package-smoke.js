#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "superloop-package-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packageSmokeEnvironment = { ...process.env, npm_config_dry_run: "false" };

try {
  const packed = JSON.parse(run(
    npm,
    ["pack", "--json", "--pack-destination", temporary],
    root,
    packageSmokeEnvironment
  ));
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
  run(binary("loopctl"), ["skill", "validate", ".agents/skills/superloop"], project);
  run(binary("loopctl"), ["skill", "validate", ".claude/skills/superloop"], project);
  const proposalTemplate = path.join(
    project,
    "node_modules",
    "@sheepxux",
    "superloop",
    "templates",
    "proposal.yaml"
  );
  const proposalData = YAML.parse(fs.readFileSync(proposalTemplate, "utf8"));
  proposalData.readiness = { status: "ready-for-review", blockers: [], warnings: [] };
  proposalData.assumptions[0].status = "confirmed";
  proposalData.prerequisites[0].status = "met";
  const proposal = path.join(project, "reviewed-proposal.yaml");
  fs.writeFileSync(proposal, YAML.stringify(proposalData));
  run(binary("loopctl"), ["proposal", "validate", proposal], project);
  run(binary("loopctl"), [
    "proposal", "decide", proposal,
    "--approve", "--actor", "package-smoke-human", "--reason", "reviewed package fixture",
    "--out", "proposal-decision.json"
  ], project);
  run(binary("loopctl"), [
    "proposal", "compile", proposal,
    "--decision", "proposal-decision.json", "--out", "approved-loop.yaml"
  ], project);
  run(binary("loopctl"), [
    "init", "example-loop", "--from", "approved-loop.yaml", "--out", ".superloop/loops"
  ], project);
  run(binary("loopctl"), ["init", "package-smoke", "--out", ".superloop/loops"], project);
  run(binary("loopctl"), ["next", ".superloop/loops/package-smoke"], project);
  run(binary("loopd"), ["start", "--once", "--loop", "package-smoke"], project);

  const finiteExample = path.join(
    project,
    "node_modules",
    "@sheepxux",
    "superloop",
    "examples",
    "finite-project",
    "loop.yaml"
  );
  run(binary("loopctl"), ["validate", finiteExample], project);
  run(binary("loopctl"), [
    "init", "finite-project", "--from", finiteExample, "--out", ".superloop/loops"
  ], project);
  const finitePlan = JSON.parse(run(
    binary("loopctl"),
    ["next", ".superloop/loops/finite-project"],
    project
  ));
  if (
    finitePlan.phase !== "work"
    || finitePlan.itemsAllowed !== 1
    || finitePlan.eligibleParts?.[0]?.id !== "establish-foundation"
  ) {
    throw new Error("Packed finite Work Plan did not initialize with the expected dependency-ready Part.");
  }

  const cache = path.join(temporary, "codex-cache");
  copyWithoutDependencies(root, cache);
  const helper = path.join(cache, "skills", "superloop", "scripts", "run-loopctl.mjs");
  run(process.execPath, [helper, "doctor"], project, {
    ...packageSmokeEnvironment,
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
    "superloop",
    "package.json"
  );
  const staleManifest = JSON.parse(fs.readFileSync(staleManifestPath, "utf8"));
  staleManifest.version = "1.0.1";
  fs.writeFileSync(staleManifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(staleProject, "node_modules", "@sheepxux", "superloop", "bin", "loopctl.js"),
    'process.stderr.write("stale 1.0.1 runtime was executed\\n"); process.exit(86);\n'
  );

  const fallbackOutput = run(process.execPath, [helper, "doctor"], staleProject, {
    ...packageSmokeEnvironment,
    LOOP_ENGINEERING_RUNTIME_PACKAGE: tarball
  });
  if (!fallbackOutput.includes("Codex plugin version matches package version 2.0.0")) {
    throw new Error("Runtime helper did not fall back from stale 1.0.1 to the current 2.0.0 tarball.");
  }
  console.log(`Package smoke passed: ${packed[0].filename}`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

function run(command, args, cwd, env = packageSmokeEnvironment) {
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
