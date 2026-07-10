#!/usr/bin/env node
import { daemonMain } from "../src/daemon-cli.js";

daemonMain(process.argv.slice(2)).catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
