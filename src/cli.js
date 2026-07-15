import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { copyFile, loopAdminLockPath, readData, readText, repoRoot, schemaPath, sha256Json, withFileLock, writeJson, writeJsonExclusive, writeText, writeYaml, writeYamlExclusive } from "./fs-utils.js";
import { runDoctor } from "./doctor.js";
import { initialEvolutionState, initialStrategy } from "./evolution.js";
import { migrateLoopState, nextRun, readLoopState, recordExperiment, recordRun, rejectPendingExperiment, reopenWorkPlanPart, resolveGoalAttention, resolveLoop, rollbackStrategy } from "./loop-state.js";
import { renderAdapter, RENDERERS } from "./renderers.js";
import { listRuns, setPaused, statusLoops } from "./runner.js";
import { compileProposal, createProposalDecision, createProposalRevision, validateProposalFile, validateProposalRevision } from "./proposal.js";
import {
  CANONICAL_SKILL_DIR,
  installCanonicalSkill,
  SKILL_PLATFORMS,
  validateSkillPackage
} from "./skill-package.js";
import { validateData, validateLoopFile, validateLoopSpec } from "./validation.js";

export async function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "validate") {
    return validateCommand(rest);
  }
  if (command === "init") {
    return initCommand(rest);
  }
  if (command === "render") {
    return renderCommand(rest);
  }
  if (command === "schema") {
    return schemaCommand(rest);
  }
  if (command === "next") {
    return nextCommand(rest);
  }
  if (command === "record") {
    return recordCommand(rest);
  }
  if (command === "evolve") {
    return evolveCommand(rest);
  }
  if (command === "status") {
    return statusCommand(rest);
  }
  if (command === "runs") {
    return runsCommand(rest);
  }
  if (command === "pause") {
    return pauseCommand(rest);
  }
  if (command === "resume") {
    return resumeCommand(rest);
  }
  if (command === "part") {
    return partCommand(rest);
  }
  if (command === "goal") {
    return goalCommand(rest);
  }
  if (command === "check") {
    return checkCommand(rest);
  }
  if (command === "doctor") {
    return doctorCommand();
  }
  if (command === "skill") {
    return skillCommand(rest);
  }
  if (command === "proposal") {
    return proposalCommand(rest);
  }
  if (command === "strategy") {
    return strategyCommand(rest);
  }
  if (command === "approval") {
    return approvalCommand(rest);
  }
  if (command === "experiment") {
    return experimentCommand(rest);
  }
  if (command === "migrate") {
    return migrateCommand(rest);
  }

  throw new Error(`Unknown command "${command}". Run loopctl --help.`);
}

function validateCommand(args) {
  if (args.length === 0) {
    throw new Error("Usage: loopctl validate <loop.yaml...>");
  }

  let failed = false;
  for (const file of args) {
    const result = validateLoopFile(file);
    printValidationResult(result);
    if (!result.ok) failed = true;
  }

  if (failed) {
    process.exitCode = 1;
  }
}

function initCommand(args) {
  const name = args[0];
  if (!name) {
    throw new Error(
      "Usage: loopctl init <loop-name> --from <loop.yaml> --out <directory> [--force]. "
      + "For approved contracts, <loop-name> must equal metadata.name and --out must be .loop-engineering/loops."
    );
  }

  const options = parseOptions(args.slice(1));
  const source = options.from || path.join(repoRoot, "skills", "loop-engineering", "assets", "loop.yaml");
  const outRoot = options.out || ".loop-engineering/loops";
  const force = options.force === true;
  const spec = readData(source);
  const approvedContract = spec.metadata?.provenance !== undefined;
  if (approvedContract && spec.metadata.name !== name) {
    throw new Error(
      `Approved contract name is "${spec.metadata.name}", not "${name}". `
      + "Revise and re-approve the Proposal instead of mutating a provenance-bound contract during init."
    );
  }
  if (!approvedContract) {
    spec.metadata.name = name;
    const contractRoot = path.posix.join(".loop-engineering", "loops", name);
    spec.persistence.statePath = path.posix.join(contractRoot, "state.json");
    spec.persistence.runLogDir = path.posix.join(contractRoot, "runs");
    spec.persistence.inboxPath = path.posix.join(contractRoot, "inbox.md");
    spec.persistence.decisionsPath = path.posix.join(contractRoot, "decisions.md");
    if (spec.evolution?.enabled) {
      spec.persistence.strategyPath = path.posix.join(contractRoot, "strategy.json");
      spec.persistence.experimentDir = path.posix.join(contractRoot, "experiments");
    }
    spec.schedule.concurrency.group = name;
    if (spec.handoff?.worktree?.branchPrefix) {
      spec.handoff.worktree.branchPrefix = normalizeBranchPrefix(spec.handoff.worktree.branchPrefix, name);
    }
  }

  const result = validateLoopSpec(spec, source);
  if (!result.ok) {
    printValidationResult(result);
    throw new Error("Refusing to initialize an invalid loop spec.");
  }
  if (approvedContract) {
    assertApprovedInitLayout(spec, name, outRoot);
  }

  const loopDir = path.join(outRoot, name);
  return withFileLock(loopAdminLockPath(loopDir), () => {
  if (fs.existsSync(loopDir) && !force && fs.readdirSync(loopDir).length > 0) {
    throw new Error(`Refusing to overwrite non-empty directory: ${loopDir}. Pass --force to replace files.`);
  }
  if (fs.existsSync(loopDir) && force) {
    assertForceReplaceIsSafe(loopDir);
    fs.rmSync(loopDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(loopDir, "runs"), { recursive: true });
  if (spec.evolution?.enabled) {
    fs.mkdirSync(path.join(loopDir, "experiments"), { recursive: true });
    fs.mkdirSync(path.join(loopDir, "strategies"), { recursive: true });
  }
  writeYaml(path.join(loopDir, "loop.yaml"), spec);
  const state = {
    apiVersion: "loop-engineering/v1",
    loop: name,
    generation: crypto.randomUUID(),
    contractSha256: sha256Json(spec),
    lastRunAt: null,
    paused: false,
    pauseReason: null,
    items: spec.workPlan
      ? spec.workPlan.parts.map((part) => ({
          id: part.id,
          status: "open",
          retries: 0,
          source: "work-plan",
          summary: part.title,
          artifacts: [],
          lastResult: null
        }))
      : [],
    recordedRuns: [],
    budgets: {
      date: null,
      runsToday: 0,
      runtimeMinutesToday: 0,
      estimatedUsdToday: 0
    }
  };
  if (spec.workPlan) {
    state.partResolutions = [];
    state.goalResolutions = [];
    state.lifecycle = {
      status: "active",
      completedAt: null,
      goalEvaluationAttempts: 0,
      lastGoalEvaluation: null
    };
  }
  if (spec.evolution?.enabled) {
    const strategy = initialStrategy(spec, name);
    state.evolution = initialEvolutionState(strategy);
    writeJson(path.join(loopDir, "strategy.json"), strategy);
    writeJson(path.join(loopDir, "strategies", "v1.json"), strategy);
  }
  writeJson(path.join(loopDir, "state.json"), state);
  writeText(path.join(loopDir, "inbox.md"), `# ${name} Inbox\n\nBlocked or human-review items land here.\n`);
  writeText(path.join(loopDir, "decisions.md"), `# ${name} Decisions\n\nRecord durable human decisions here.\n`);

  console.log(`Initialized ${loopDir}`);
  });
}

function renderCommand(args) {
  const adapter = args[0];
  const file = args[1];
  if (!adapter || !file) {
    throw new Error(`Usage: loopctl render <${[...RENDERERS].join("|")}> <loop.yaml> --out <directory>`);
  }

  const options = parseOptions(args.slice(2));
  const outDir = options.out || "rendered";
  const spec = readData(file);
  const result = validateLoopSpec(spec, file);
  if (!result.ok) {
    printValidationResult(result);
    throw new Error("Refusing to render an invalid loop spec.");
  }

  const targets = renderAdapter(adapter, spec, outDir);
  for (const target of targets) {
    console.log(`Rendered ${target}`);
  }
}

function schemaCommand(args) {
  const name = args[0] || "loop";
  const options = parseOptions(args.slice(1));
  const source = schemaPath(name);
  if (options.out) {
    copyFile(source, options.out);
    console.log(`Wrote ${options.out}`);
    return;
  }
  process.stdout.write(readText(source));
}

function nextCommand(args) {
  const target = args[0];
  if (!target) {
    throw new Error("Usage: loopctl next <loop-dir|loop.yaml>");
  }

  const loop = resolveLoop(target);
  const plan = nextRun(loop);
  console.log(JSON.stringify(plan, null, 2));
  if (!plan.ok) {
    process.exitCode = 2;
  }
}

function recordCommand(args) {
  const target = args[0];
  const options = parseOptions(args.slice(1));
  if (!target || !options.run || options.run === true) {
    throw new Error("Usage: loopctl record <loop-dir|loop.yaml> --run <run-log.json>");
  }

  const loop = resolveLoop(target);
  const runLog = readData(options.run);
  const outcome = recordRun(loop, runLog);

  console.log(`Recorded ${outcome.runFile}`);
  console.log(`Updated ${outcome.statePath}`);
  const budgets = outcome.state.budgets;
  console.log(
    `Budgets today: ${budgets.runsToday} run(s), ${budgets.runtimeMinutesToday} runtime minute(s), $${budgets.estimatedUsdToday} estimated`
  );
  for (const item of outcome.attention) {
    console.log(`ATTENTION ${item.id} is ${item.status}; add it to ${loop.inboxPath}`);
  }
}

function evolveCommand(args) {
  const target = args[0];
  const options = parseOptions(args.slice(1));
  if (!target || !options.experiment || options.experiment === true) {
    throw new Error("Usage: loopctl evolve <loop-dir|loop.yaml> --experiment <experiment.json> [--approval <approval.json>]");
  }

  const loop = resolveLoop(target);
  const experiment = readData(options.experiment);
  const approval = typeof options.approval === "string" ? readData(options.approval) : null;
  const outcome = recordExperiment(loop, experiment, { approval });

  console.log(`Experiment ${outcome.assessment.outcome}: ${outcome.experimentFile}`);
  console.log(`Measured improvement: ${outcome.assessment.improvement}`);
  if (outcome.assessment.outcome === "promoted") {
    console.log(`Promoted strategy v${outcome.assessment.candidateVersion}: ${outcome.strategyPath}`);
  } else if (outcome.assessment.outcome === "pending-review") {
    console.log("Candidate passed the metric gate and is waiting for a digest-bound approval artifact. Re-run with --approval <approval.json>.");
  } else {
    console.log("Candidate was not promoted; the current strategy remains active.");
  }
}

function statusCommand(args) {
  const options = parseOptions(args);
  const statuses = statusLoops({ root: options.root || ".loop-engineering/loops" });
  if (options.json === true) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  if (statuses.length === 0) {
    console.log("No loops found.");
    return;
  }
  for (const status of statuses) {
    if (status.error) {
      console.log(`${status.loop}\terror\t${status.error}`);
      continue;
    }
    const state = status.lifecycle === "completed"
      ? "completed"
      : status.paused
        ? "paused"
        : !status.preflightOk
          ? "blocked"
          : status.due
            ? "ready"
            : "idle";
    console.log(
      `${status.loop}\t${state}\tdue=${status.due}\tphase=${status.phase || "legacy"}\truns-left=${status.runsRemainingToday}\tretries=${status.retryItems}\thuman=${status.needsHuman}\trunner=${status.runner || "none"}`
    );
  }
}

function runsCommand(args) {
  const target = args[0];
  if (!target) {
    throw new Error("Usage: loopctl runs <loop-dir|loop.yaml> [--json]");
  }
  const options = parseOptions(args.slice(1));
  const runs = listRuns(target);
  if (options.json === true) {
    console.log(JSON.stringify(runs, null, 2));
    return;
  }
  for (const run of runs) {
    console.log(`${run.runId}\t${run.status}\t${run.finishedAt || "-"}\t${run.file}`);
  }
}

function pauseCommand(args) {
  const target = args[0];
  if (!target) {
    throw new Error("Usage: loopctl pause <loop-dir|loop.yaml> [--reason <text>]");
  }
  const options = parseOptions(args.slice(1));
  const outcome = setPaused(target, true, typeof options.reason === "string" ? options.reason : null);
  console.log(`Paused ${outcome.loop}: ${outcome.pauseReason}`);
}

function resumeCommand(args) {
  const target = args[0];
  if (!target) {
    throw new Error("Usage: loopctl resume <loop-dir|loop.yaml>");
  }
  const outcome = setPaused(target, false);
  console.log(`Resumed ${outcome.loop}`);
}

function partCommand(args) {
  const [subcommand, target, ...rest] = args;
  if (subcommand !== "reopen" || !target) {
    throw new Error("Usage: loopctl part reopen <loop-dir|loop.yaml> --id <part-id> --actor <human> --reason <text>");
  }
  const options = parseOptions(rest);
  if (
    typeof options.id !== "string"
    || typeof options.actor !== "string"
    || typeof options.reason !== "string"
  ) {
    throw new Error("Part reopening requires --id, --actor, and --reason.");
  }
  const outcome = reopenWorkPlanPart(target, {
    partId: options.id,
    actor: options.actor,
    reason: options.reason
  });
  console.log(`Reopened ${outcome.loop} Part ${outcome.partId}`);
  console.log(`Resolution ${outcome.resolution.id} binds run ${outcome.resolution.evidenceRunId}`);
}

function goalCommand(args) {
  const [subcommand, target, ...rest] = args;
  if (subcommand !== "resolve" || !target) {
    throw new Error("Usage: loopctl goal resolve <loop-dir|loop.yaml> --actor <human> --reason <text>");
  }
  const options = parseOptions(rest);
  if (typeof options.actor !== "string" || typeof options.reason !== "string") {
    throw new Error("Goal attention resolution requires --actor and --reason.");
  }
  const outcome = resolveGoalAttention(target, {
    actor: options.actor,
    reason: options.reason
  });
  console.log(`Resolved ${outcome.loop} final Goal attention`);
  console.log(`Resolution ${outcome.resolution.id} binds run ${outcome.resolution.evidenceRunId}`);
}

function checkCommand(args) {
  const schemaName = args[0];
  const files = args.slice(1);
  if (!schemaName || files.length === 0) {
    throw new Error(
      "Usage: loopctl check <loop|state|evaluator|goal-evaluation|run-log|strategy|experiment|approval|decision|proposal|proposal-decision> <file...>"
    );
  }

  let failed = false;
  for (const file of files) {
    const result = schemaName === "loop"
      ? validateLoopFile(file)
      : schemaName === "proposal"
        ? validateProposalFile(file)
        : validateData(schemaName, readData(file), file);
    printValidationResult(result);
    if (!result.ok) failed = true;
  }

  if (failed) {
    process.exitCode = 1;
  }
}

function proposalCommand(args) {
  const action = args[0];
  const proposalPath = args[1];

  if (action === "validate" && args.length > 1) {
    const validateArgs = args.slice(1);
    const parentFlags = validateArgs.reduce(
      (indexes, value, index) => value === "--parent" ? [...indexes, index] : indexes,
      []
    );
    if (parentFlags.length > 1) {
      throw new Error("proposal validate accepts at most one --parent <proposal.yaml> option.");
    }
    let parentPath = null;
    if (parentFlags.length === 1) {
      const parentIndex = parentFlags[0];
      parentPath = validateArgs[parentIndex + 1];
      if (!parentPath || parentPath.startsWith("--")) {
        throw new Error("Usage: loopctl proposal validate <proposal.yaml> --parent <parent-proposal.yaml>");
      }
      validateArgs.splice(parentIndex, 2);
    }
    if (validateArgs.length === 0 || validateArgs.some((value) => value.startsWith("--"))) {
      throw new Error("Usage: loopctl proposal validate <proposal.yaml...> [--parent <parent-proposal.yaml>]");
    }
    if (parentPath !== null && validateArgs.length !== 1) {
      throw new Error("Parent-aware validation accepts exactly one proposal revision.");
    }
    let failed = false;
    for (const file of validateArgs) {
      const result = parentPath === null
        ? validateProposalFile(file)
        : validateProposalRevision(readData(file), readData(parentPath), file);
      printValidationResult(result);
      if (result.ok) {
        const proposal = readData(file);
        console.log(`READINESS ${proposal.readiness.status}`);
        for (const blocker of proposal.readiness.blockers) console.log(`BLOCKER ${blocker}`);
      } else {
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
    return;
  }

  if (action === "revise" && proposalPath) {
    const options = parseOptions(args.slice(2));
    if (typeof options.out !== "string") {
      throw new Error("Usage: loopctl proposal revise <parent-proposal.yaml> --out <proposal.yaml>");
    }
    const revision = createProposalRevision(readData(proposalPath));
    writeExclusiveArtifact(
      options.out,
      "proposal revision",
      () => writeYamlExclusive(options.out, revision)
    );
    console.log(`Created proposal revision ${revision.metadata.revision}: ${options.out}`);
    console.log(`Parent proposal SHA-256: ${revision.metadata.parentProposalSha256}`);
    return;
  }

  if (action === "decide" && proposalPath) {
    const options = parseOptions(args.slice(2));
    const decisions = ["approve", "reject", "request-changes"].filter((name) => options[name] === true);
    if (
      decisions.length !== 1
      || typeof options.actor !== "string"
      || typeof options.reason !== "string"
      || typeof options.out !== "string"
      || (decisions[0] === "request-changes" && typeof options.change !== "string")
    ) {
      throw new Error(
        "Usage: loopctl proposal decide <proposal.yaml> --approve|--reject|--request-changes [--change <text>] "
        + "[--parent <parent-proposal.yaml> for revision>1] --actor <human> --reason <text> --out <decision.json>"
      );
    }
    const decision = createProposalDecision(readData(proposalPath), {
      decision: decisions[0],
      actor: options.actor,
      reason: options.reason,
      requestedChanges: decisions[0] === "request-changes" ? [options.change] : [],
      parentProposal: typeof options.parent === "string" ? readData(options.parent) : null
    });
    writeExclusiveArtifact(
      options.out,
      "proposal decision",
      () => writeJsonExclusive(options.out, decision)
    );
    console.log(`Wrote digest-bound proposal decision: ${options.out}`);
    return;
  }

  if (action === "compile" && proposalPath) {
    const options = parseOptions(args.slice(2));
    if (typeof options.decision !== "string" || typeof options.out !== "string") {
      throw new Error(
        "Usage: loopctl proposal compile <proposal.yaml> --decision <decision.json> "
        + "[--parent <parent-proposal.yaml> for revision>1] --out <loop.yaml>"
      );
    }
    const compiled = compileProposal(readData(proposalPath), readData(options.decision), {
      parentProposal: typeof options.parent === "string" ? readData(options.parent) : null
    });
    writeExclusiveArtifact(
      options.out,
      "compiled Loop contract",
      () => writeYamlExclusive(options.out, compiled)
    );
    console.log(`Compiled approved Loop contract: ${options.out}`);
    console.log(`Proposal SHA-256: ${compiled.metadata.provenance.proposal.sha256}`);
    console.log(`Decision SHA-256: ${compiled.metadata.provenance.decision.sha256}`);
    return;
  }

  throw new Error(
    "Usage: loopctl proposal <validate|revise|decide|compile> <proposal.yaml> [options]"
  );
}

function writeExclusiveArtifact(filePath, label, writer) {
  try {
    writer();
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing ${label}: ${filePath}`);
    }
    throw error;
  }
}

function doctorCommand() {
  const result = runDoctor();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function skillCommand(args) {
  const action = args[0];
  if (action === "validate") {
    const target = args[1] && !args[1].startsWith("--") ? args[1] : CANONICAL_SKILL_DIR;
    const options = parseOptions(args.slice(target === CANONICAL_SKILL_DIR ? 1 : 2));
    const result = validateSkillPackage(target);
    if (options.json === true) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      console.log(`OK Skill ${result.metadata.name} (${result.lineCount} lines): ${result.skillDir}`);
      for (const warning of result.warnings) console.log(`WARN ${warning}`);
    } else {
      console.error(`FAIL Skill: ${result.skillDir}`);
      for (const error of result.errors) console.error(`- ${error}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (action === "install") {
    const platform = args[1];
    if (!platform || (platform !== "both" && !SKILL_PLATFORMS.has(platform))) {
      throw new Error("Usage: loopctl skill install <codex|claude-code|both> [--scope project|user] [--out D] [--force]");
    }
    const options = parseOptions(args.slice(2));
    const platforms = platform === "both" ? [...SKILL_PLATFORMS] : [platform];
    for (const target of platforms) {
      const result = installCanonicalSkill({
        platform: target,
        scope: typeof options.scope === "string" ? options.scope : "project",
        outDir: typeof options.out === "string" ? path.join(options.out, target) : null,
        force: options.force === true
      });
      console.log(`Installed ${target} Skill: ${result.destination}`);
    }
    return;
  }

  if (action === "path") {
    console.log(CANONICAL_SKILL_DIR);
    return;
  }

  throw new Error("Usage: loopctl skill <validate [dir]|install <platform>|path>");
}

function strategyCommand(args) {
  const action = args[0];
  const target = args[1];
  if (action !== "rollback" || !target) {
    throw new Error("Usage: loopctl strategy rollback <loop-dir|loop.yaml> --to <version> --actor <name> --reason <text>");
  }
  const options = parseOptions(args.slice(2));
  const version = Number(options.to);
  const outcome = rollbackStrategy(resolveLoop(target), version, {
    actor: typeof options.actor === "string" ? options.actor : "",
    reason: typeof options.reason === "string" ? options.reason : ""
  });
  console.log(
    `Restored behavior from strategy v${outcome.restoredFromVersion} as new strategy v${outcome.strategy.version}: ${outcome.strategyPath}`
  );
}

function approvalCommand(args) {
  const action = args[0];
  const target = args[1];
  const options = parseOptions(args.slice(2));
  if (
    action !== "create" ||
    !target ||
    typeof options.experiment !== "string" ||
    typeof options.approver !== "string" ||
    typeof options.reason !== "string" ||
    typeof options.out !== "string"
  ) {
    throw new Error(
      "Usage: loopctl approval create <loop-dir|loop.yaml> --experiment <file> --approver <name> --reason <text> --out <approval.json>"
    );
  }
  const loop = resolveLoop(target);
  const experiment = readData(options.experiment);
  const digest = sha256Json(experiment);
  const state = readLoopState(loop);
  const pending = state.evolution?.pendingExperiment;
  if (!pending || pending.experimentId !== experiment.experimentId || pending.sha256 !== digest) {
    throw new Error("The experiment is not the exact pending candidate recorded in loop state.");
  }
  if (options.approver.trim().length === 0 || options.reason.trim().length < 3) {
    throw new Error("Strategy approval requires a non-empty approver and a meaningful reason.");
  }
  const approval = {
    apiVersion: "loop-engineering/v1",
    loop: experiment.loop,
    experimentId: experiment.experimentId,
    experimentSha256: digest,
    baselineVersion: experiment.baseline.version,
    approver: options.approver.trim(),
    approvedAt: new Date().toISOString(),
    reason: options.reason.trim()
  };
  const validation = validateData("approval", approval, options.out);
  if (!validation.ok) throw new Error(`Refusing to write invalid approval: ${validation.errors.join("; ")}`);
  writeExclusiveArtifact(
    options.out,
    "strategy approval",
    () => writeJsonExclusive(options.out, approval)
  );
  console.log(`Wrote digest-bound approval: ${options.out}`);
}

function experimentCommand(args) {
  const action = args[0];
  const target = args[1];
  const options = parseOptions(args.slice(2));
  if (
    action !== "reject"
    || !target
    || typeof options.experiment !== "string"
    || typeof options.actor !== "string"
    || typeof options.reason !== "string"
  ) {
    throw new Error(
      "Usage: loopctl experiment reject <loop-dir|loop.yaml> --experiment <file> --actor <human> --reason <text>"
    );
  }
  const outcome = rejectPendingExperiment(resolveLoop(target), readData(options.experiment), {
    actor: options.actor,
    reason: options.reason
  });
  console.log(`Rejected pending experiment with immutable decision: ${outcome.decisionFile}`);
  console.log(`Updated ${outcome.statePath}`);
}

function migrateCommand(args) {
  const target = args[0];
  const options = parseOptions(args.slice(1));
  if (!target) throw new Error("Usage: loopctl migrate <loop-dir|loop.yaml> [--retire-expired-lease]");
  const outcome = migrateLoopState(resolveLoop(target), {
    allowRemoteExpiredLease: options["retire-expired-lease"] === true
  });
  console.log(`${outcome.alreadyMigrated ? "Integrity bindings already current" : "Migrated integrity bindings"}: ${outcome.statePath}`);
  console.log(`Generation: ${outcome.generation}`);
  console.log(`Contract SHA-256: ${outcome.contractSha256}`);
  console.log(`Anchored strategy archives: ${outcome.strategyArchives}`);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function normalizeBranchPrefix(prefix, name) {
  if (prefix.includes("example-loop") || prefix.includes("loop-example") || prefix.startsWith("codex/")) {
    return `loop-engineering/${name}`;
  }
  return prefix;
}

function assertApprovedInitLayout(spec, name, outRoot) {
  const requiredOutRoot = path.resolve(".loop-engineering", "loops");
  if (path.resolve(outRoot) !== requiredOutRoot) {
    throw new Error(
      "A provenance-bound approved contract must be initialized with --out .loop-engineering/loops "
      + "so runtime files stay at the reviewed persistence paths. Revise and re-approve to change them."
    );
  }

  const contractRoot = path.posix.join(".loop-engineering", "loops", name);
  const expected = {
    statePath: path.posix.join(contractRoot, "state.json"),
    runLogDir: path.posix.join(contractRoot, "runs"),
    inboxPath: path.posix.join(contractRoot, "inbox.md"),
    decisionsPath: path.posix.join(contractRoot, "decisions.md")
  };
  if (spec.evolution?.enabled) {
    expected.strategyPath = path.posix.join(contractRoot, "strategy.json");
    expected.experimentDir = path.posix.join(contractRoot, "experiments");
  }
  for (const [field, expectedPath] of Object.entries(expected)) {
    if (spec.persistence[field] !== expectedPath) {
      throw new Error(
        `Approved contract persistence.${field} is "${spec.persistence[field]}", expected "${expectedPath}". `
        + "Revise and re-approve the Proposal instead of relocating runtime state during init."
      );
    }
  }
}

function assertForceReplaceIsSafe(loopDir) {
  const coordinationArtifacts = [
    path.join(loopDir, "locks", "active-run.json"),
    path.join(loopDir, "locks", "state-update.lock"),
    path.join(loopDir, "locks", "state-transaction.json")
  ];
  const blocker = coordinationArtifacts.find((candidate) => pathEntryExists(candidate));
  if (blocker) {
    throw new Error(
      `Refusing to force-replace ${loopDir} while coordination artifact exists: ${blocker}. `
      + "Finish or recover the active operation before retrying."
    );
  }
}

function pathEntryExists(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function printValidationResult(result) {
  if (result.ok) {
    console.log(`OK ${result.label}`);
    for (const warning of result.warnings) {
      console.log(`WARN ${warning}`);
    }
    return;
  }

  console.error(`FAIL ${result.label}`);
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
}

function printHelp() {
  console.log(`loopctl

Commands:
  validate <loop.yaml...>                 Validate loop specs
  init <name> --from <loop.yaml> --out D  Initialize state; approved name/path must remain exact
  render <adapter> <loop.yaml> --out D    Render agent/runtime adapter files
  next <loop-dir|loop.yaml>               Print the next-run plan as JSON (budgets, retries, carryover)
  record <loop-dir> --run <run-log.json>  Validate a run log, file it under runs/, update state.json
  evolve <loop-dir> --experiment <file>   Compare a candidate strategy with baseline and promote if gated
  status [--root D] [--json]              Show loop health, budget, cadence, and runner state
  runs <loop-dir> [--json]                List recorded runs
  pause <loop-dir> [--reason TEXT]         Pause scheduling for a loop
  resume <loop-dir>                        Resume scheduling for a loop
  part reopen <loop-dir> [options]         Reopen a blocked/human Part with audited actor, reason, and run binding
  goal resolve <loop-dir> [options]        Resolve blocked/human final Goal attention with an audited run binding
  check <schema> <file...>                Validate data files against a protocol schema
  schema <loop|state|evaluator|goal-evaluation|run-log|strategy|experiment|approval|decision|proposal|proposal-decision>
                                           Print or copy a protocol schema
  doctor                                  Check whether the repo is publish-ready
  skill validate [dir] [--json]           Validate the canonical Agent Skill package
  skill install <platform> [options]      Install Skill for codex, claude-code, or both
  skill path                              Print the canonical Skill directory
  proposal validate <proposal.yaml>       Validate proposal/readiness; --parent verifies a revision
  proposal revise <proposal.yaml> [...]   Create a digest-linked next proposal revision
  proposal decide <proposal.yaml> [...]   Create a digest-bound human decision artifact
  proposal compile <proposal.yaml> [...]  Compile an approved proposal into loop.yaml
  strategy rollback <loop-dir> [options]  Restore archived strategy behavior as a new version
  approval create <loop-dir> [options]    Create a human approval bound to a pending experiment
  experiment reject <loop-dir> [options] Reject a pending experiment with an immutable human decision
  migrate <loop-dir|loop.yaml> [options]  Add v1.0.2 generation, contract, and strategy digest anchors

Adapters:
  ${[...RENDERERS].join(", ")}
`);
}
