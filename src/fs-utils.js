import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

export function readData(filePath) {
  const raw = readText(filePath);
  if (filePath.endsWith(".json")) {
    return JSON.parse(raw);
  }
  return YAML.parse(raw);
}

export function writeYaml(filePath, value) {
  writeText(filePath, YAML.stringify(value, { lineWidth: 100 }));
}

export function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

export function assertCanWriteDir(dir, { force = false } = {}) {
  if (fs.existsSync(dir) && !force && fs.readdirSync(dir).length > 0) {
    throw new Error(`Refusing to overwrite non-empty directory: ${dir}. Pass --force to replace files.`);
  }
  fs.mkdirSync(dir, { recursive: true });
}

export function schemaPath(name) {
  const file = {
    loop: "loop.schema.json",
    state: "state.schema.json",
    evaluator: "evaluator.schema.json",
    "run-log": "run-log.schema.json"
  }[name];
  if (!file) {
    throw new Error(`Unknown schema "${name}". Expected loop, state, evaluator, or run-log.`);
  }
  return path.join(repoRoot, "protocol", file);
}
