import fs from "node:fs";
import path from "node:path";
import { copyFile, readData, readText, repoRoot, schemaPath, writeJson, writeText, writeYaml } from "./fs-utils.js";
import { runDoctor } from "./doctor.js";
import { initialEvolutionState, initialStrategy } from "./evolution.js";
import { nextRun, recordExperiment, recordRun, resolveLoop } from "./loop-state.js";
import { renderAdapter, RENDERERS } from "./renderers.js";
import { listRuns, setPaused, statusLoops } from "./runner.js";
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
  if (command === "check") {
    return checkCommand(rest);
  }
  if (command === "doctor") {
    return doctorCommand();
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
    throw new Error("Usage: loopctl init <loop-name> --from <loop.yaml> --out <directory> [--force]");
  }

  const options = parseOptions(args.slice(1));
  const source = options.from || path.join(repoRoot, "templates", "loop.yaml");
  const outRoot = options.out || ".loop-engineering/loops";
  const force = options.force === true;
  const spec = readData(source);
  spec.metadata.name = name;
  spec.persistence.statePath = path.join(outRoot, name, "state.json");
  spec.persistence.runLogDir = path.join(outRoot, name, "runs");
  spec.persistence.inboxPath = path.join(outRoot, name, "inbox.md");
  spec.persistence.decisionsPath = path.join(outRoot, name, "decisions.md");
  if (spec.evolution?.enabled) {
    spec.persistence.strategyPath = path.join(outRoot, name, "strategy.json");
    spec.persistence.experimentDir = path.join(outRoot, name, "experiments");
  }
  spec.schedule.concurrency.group = name;
  if (spec.handoff?.worktree?.branchPrefix) {
    spec.handoff.worktree.branchPrefix = normalizeBranchPrefix(spec.handoff.worktree.branchPrefix, name);
  }

  const result = validateLoopSpec(spec, source);
  if (!result.ok) {
    printValidationResult(result);
    throw new Error("Refusing to initialize an invalid loop spec.");
  }

  const loopDir = path.join(outRoot, name);
  if (fs.existsSync(loopDir) && !force && fs.readdirSync(loopDir).length > 0) {
    throw new Error(`Refusing to overwrite non-empty directory: ${loopDir}. Pass --force to replace files.`);
  }

  fs.mkdirSync(path.join(loopDir, "runs"), { recursive: true });
  if (spec.evolution?.enabled) {
    fs.mkdirSync(path.join(loopDir, "experiments"), { recursive: true });
  }
  writeYaml(path.join(loopDir, "loop.yaml"), spec);
  const state = {
    apiVersion: "loop-engineering/v1",
    loop: name,
    lastRunAt: null,
    paused: false,
    pauseReason: null,
    items: [],
    budgets: {
      runsToday: 0,
      runtimeMinutesToday: 0,
      estimatedUsdToday: 0
    }
  };
  if (spec.evolution?.enabled) {
    state.evolution = initialEvolutionState();
    writeJson(path.join(loopDir, "strategy.json"), initialStrategy(spec, name));
  }
  writeJson(path.join(loopDir, "state.json"), state);
  writeText(path.join(loopDir, "inbox.md"), `# ${name} Inbox\n\nBlocked or human-review items land here.\n`);
  writeText(path.join(loopDir, "decisions.md"), `# ${name} Decisions\n\nRecord durable human decisions here.\n`);

  console.log(`Initialized ${loopDir}`);
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
    throw new Error("Usage: loopctl record <loop-dir|loop.yaml> --run <run-log.json> [--force]");
  }

  const loop = resolveLoop(target);
  const runLog = readData(options.run);
  const outcome = recordRun(loop, runLog, { force: options.force === true });

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
    throw new Error("Usage: loopctl evolve <loop-dir|loop.yaml> --experiment <experiment.json> [--approve] [--force]");
  }

  const loop = resolveLoop(target);
  const experiment = readData(options.experiment);
  const outcome = recordExperiment(loop, experiment, {
    approve: options.approve === true,
    force: options.force === true
  });

  console.log(`Experiment ${outcome.assessment.outcome}: ${outcome.experimentFile}`);
  console.log(`Measured improvement: ${outcome.assessment.improvement}`);
  if (outcome.assessment.outcome === "promoted") {
    console.log(`Promoted strategy v${outcome.assessment.candidateVersion}: ${outcome.strategyPath}`);
  } else if (outcome.assessment.outcome === "pending-review") {
    console.log("Candidate passed the metric gate and is waiting for human approval. Re-run with --approve.");
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
    const state = status.paused ? "paused" : !status.preflightOk ? "blocked" : status.due ? "ready" : "idle";
    console.log(
      `${status.loop}\t${state}\tdue=${status.due}\truns-left=${status.runsRemainingToday}\tretries=${status.retryItems}\thuman=${status.needsHuman}\trunner=${status.runner || "none"}`
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

function checkCommand(args) {
  const schemaName = args[0];
  const files = args.slice(1);
  if (!schemaName || files.length === 0) {
    throw new Error("Usage: loopctl check <loop|state|evaluator|run-log|strategy|experiment> <file...>");
  }

  let failed = false;
  for (const file of files) {
    const result = schemaName === "loop"
      ? validateLoopFile(file)
      : validateData(schemaName, readData(file), file);
    printValidationResult(result);
    if (!result.ok) failed = true;
  }

  if (failed) {
    process.exitCode = 1;
  }
}

function doctorCommand() {
  const result = runDoctor();
  if (!result.ok) {
    process.exitCode = 1;
  }
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
  init <name> --from <loop.yaml> --out D  Initialize loop state directory
  render <adapter> <loop.yaml> --out D    Render agent/runtime adapter files
  next <loop-dir|loop.yaml>               Print the next-run plan as JSON (budgets, retries, carryover)
  record <loop-dir> --run <run-log.json>  Validate a run log, file it under runs/, update state.json
  evolve <loop-dir> --experiment <file>   Compare a candidate strategy with baseline and promote if gated
  status [--root D] [--json]              Show loop health, budget, cadence, and runner state
  runs <loop-dir> [--json]                List recorded runs
  pause <loop-dir> [--reason TEXT]         Pause scheduling for a loop
  resume <loop-dir>                        Resume scheduling for a loop
  check <schema> <file...>                Validate data files against a protocol schema
  schema <loop|state|evaluator|run-log|strategy|experiment>
                                           Print or copy a protocol schema
  doctor                                  Check whether the repo is publish-ready

Adapters:
  ${[...RENDERERS].join(", ")}
`);
}
