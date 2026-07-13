import { runTick } from "./runner.js";

export async function daemonMain(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command !== "start") {
    throw new Error(`Unknown loopd command "${command}". Run loopd --help.`);
  }

  const options = parseOptions(rest);
  const root = options.root || ".loop-engineering/loops";
  const loopName = typeof options.loop === "string" ? options.loop : null;
  const once = options.once === true;
  const allowCommand = options["allow-command"] === true;
  const pollSeconds = Number(options["poll-seconds"] || 30);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 1 || pollSeconds > 3600) {
    throw new Error("--poll-seconds must be an integer from 1 to 3600.");
  }

  let stopping = false;
  let onceHadError = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    do {
      const outcomes = runTick({ root, loopName, allowCommand, forceManual: once && Boolean(loopName) });
      for (const outcome of outcomes) {
        console.log(JSON.stringify(outcome));
      }
      if (once && outcomes.some((outcome) => outcome.status === "error")) {
        onceHadError = true;
      }
      if (once || stopping) break;
      await delay(pollSeconds * 1000);
    } while (!stopping);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }

  if (onceHadError) {
    process.exitCode = 1;
  }
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`loopd

Commands:
  start --once [--root D] [--loop NAME]  Run one scheduler tick
  start [--root D] [--poll-seconds N]     Poll and run due loops continuously
  --allow-command                         Explicitly allow configured local commands
`);
}
