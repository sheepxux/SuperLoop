import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { repoRoot } from "./fs-utils.js";

export const CANONICAL_SKILL_DIR = path.join(repoRoot, "skills", "loop-engineering");
export const SKILL_PLATFORMS = new Set(["codex", "claude-code"]);
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;

export function validateSkillPackage(skillDir = CANONICAL_SKILL_DIR) {
  const errors = [];
  const warnings = [];
  const root = path.resolve(skillDir);
  const skillFile = path.join(root, "SKILL.md");

  if (!fs.existsSync(skillFile)) {
    return { ok: false, errors: [`Missing required file: ${skillFile}`], warnings, skillDir: root };
  }

  const source = fs.readFileSync(skillFile, "utf8");
  const parsed = parseFrontmatter(source, errors);
  const metadata = parsed?.metadata || {};
  const folderName = path.basename(root);

  const standardMetadataKeys = new Set(["name", "description", "license", "allowed-tools"]);
  const extraMetadataKeys = Object.keys(metadata).filter((key) => !standardMetadataKeys.has(key));
  const installedByGitHub = root !== path.resolve(CANONICAL_SKILL_DIR)
    && extraMetadataKeys.length === 1
    && extraMetadataKeys[0] === "metadata"
    && validGitHubInstallMetadata(metadata.metadata);
  if (extraMetadataKeys.length > 0 && !installedByGitHub) {
    errors.push("SKILL.md frontmatter contains unsupported fields; GitHub CLI source-tracking metadata is accepted on installed copies.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name || "")) {
    errors.push("Skill name must use lowercase letters, digits, and single hyphens only.");
  }
  if ((metadata.name || "").length > 64) {
    errors.push("Skill name must be at most 64 characters.");
  }
  if (metadata.name && metadata.name !== folderName) {
    errors.push(`Skill name "${metadata.name}" must match parent directory "${folderName}".`);
  }
  if (typeof metadata.description !== "string" || metadata.description.trim().length === 0) {
    errors.push("Skill description must be a non-empty string.");
  } else if (metadata.description.length > 1024) {
    errors.push("Skill description must be at most 1024 characters.");
  }
  if (metadata.license !== undefined && (typeof metadata.license !== "string" || metadata.license.trim().length === 0)) {
    errors.push("Skill license must be a non-empty string when provided.");
  }
  if (metadata["allowed-tools"] !== undefined && typeof metadata["allowed-tools"] !== "string") {
    errors.push("Skill allowed-tools must be a string when provided.");
  }

  const lineCount = source.split(/\r?\n/).length;
  if (lineCount > 500) {
    errors.push(`SKILL.md has ${lineCount} lines; keep it at or below 500.`);
  }
  if (/\[TODO:|\bTODO\b/.test(source)) {
    errors.push("SKILL.md contains a TODO placeholder.");
  }

  for (const directory of ["agents", "references", "scripts", "assets", "evals"]) {
    if (!fs.statSync(path.join(root, directory), { throwIfNoEntry: false })?.isDirectory()) {
      errors.push(`Missing Skill directory: ${directory}/`);
    }
  }
  for (const forbidden of ["README.md", "INSTALLATION_GUIDE.md", "QUICK_REFERENCE.md", "CHANGELOG.md"]) {
    if (fs.existsSync(path.join(root, forbidden))) {
      errors.push(`Extraneous Skill file: ${forbidden}`);
    }
  }

  validateOpenAiMetadata(root, metadata.name, errors);
  validateLinkedResources(root, source, errors, warnings);
  validateEvals(root, metadata.name, errors);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metadata,
    lineCount,
    skillDir: root
  };
}

export function installCanonicalSkill({
  platform,
  scope = "project",
  outDir = null,
  force = false,
  cwd = process.cwd(),
  home = os.homedir(),
  codexHome = process.env.CODEX_HOME || path.join(home, ".codex")
}) {
  if (!SKILL_PLATFORMS.has(platform)) {
    throw new Error(`Unknown Skill platform "${platform}". Expected codex or claude-code.`);
  }
  if (scope !== "project" && scope !== "user") {
    throw new Error(`Unknown Skill scope "${scope}". Expected project or user.`);
  }

  const validation = validateSkillPackage(CANONICAL_SKILL_DIR);
  if (!validation.ok) {
    throw new Error(`Canonical Skill is invalid: ${validation.errors.join("; ")}`);
  }

  const parent = outDir
    ? path.resolve(outDir)
    : defaultInstallParent(platform, scope, { cwd, home, codexHome });
  const destination = path.join(parent, "loop-engineering");
  if (fs.existsSync(destination)) {
    if (!force) {
      throw new Error(`Refusing to overwrite existing Skill: ${destination}. Pass --force to replace it.`);
    }
    fs.rmSync(destination, { recursive: true, force: true });
  }

  fs.mkdirSync(parent, { recursive: true });
  fs.cpSync(CANONICAL_SKILL_DIR, destination, { recursive: true });
  const installed = validateSkillPackage(destination);
  if (!installed.ok) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw new Error(`Installed Skill failed validation: ${installed.errors.join("; ")}`);
  }

  return { platform, scope, source: CANONICAL_SKILL_DIR, destination, validation: installed };
}

function validGitHubInstallMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const required = ["github-path", "github-ref", "github-repo", "github-tree-sha"];
  const allowed = [...required, "github-pinned"];
  return Object.keys(value).every((key) => allowed.includes(key))
    && required.every((key) => typeof value[key] === "string" && value[key].length > 0)
    && (value["github-pinned"] === undefined
      || (typeof value["github-pinned"] === "string" && value["github-pinned"].length > 0));
}

function defaultInstallParent(platform, scope, { cwd, home, codexHome }) {
  if (platform === "codex") {
    return scope === "project" ? path.join(cwd, ".agents", "skills") : path.join(codexHome, "skills");
  }
  return scope === "project" ? path.join(cwd, ".claude", "skills") : path.join(home, ".claude", "skills");
}

function parseFrontmatter(source, errors) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push("SKILL.md must begin with YAML frontmatter delimited by ---.");
    return null;
  }
  try {
    const metadata = YAML.parse(match[1]);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      errors.push("SKILL.md frontmatter must parse to a mapping.");
      return null;
    }
    return { metadata, body: source.slice(match[0].length) };
  } catch (error) {
    errors.push(`SKILL.md frontmatter is invalid YAML: ${error.message}`);
    return null;
  }
}

function validateOpenAiMetadata(root, skillName, errors) {
  const file = path.join(root, "agents", "openai.yaml");
  if (!fs.existsSync(file)) {
    errors.push("Missing agents/openai.yaml.");
    return;
  }
  try {
    const data = YAML.parse(fs.readFileSync(file, "utf8"));
    const ui = data?.interface;
    if (!ui || typeof ui !== "object") {
      errors.push("agents/openai.yaml must contain an interface mapping.");
      return;
    }
    if (typeof ui.display_name !== "string" || ui.display_name.length === 0) {
      errors.push("agents/openai.yaml interface.display_name is required.");
    }
    if (typeof ui.short_description !== "string" || ui.short_description.length < 25 || ui.short_description.length > 64) {
      errors.push("agents/openai.yaml interface.short_description must be 25-64 characters.");
    }
    if (typeof ui.default_prompt !== "string" || !ui.default_prompt.includes(`$${skillName}`)) {
      errors.push(`agents/openai.yaml interface.default_prompt must mention $${skillName}.`);
    }
    if (typeof ui.brand_color !== "string" || !/^#[A-Fa-f0-9]{6}$/.test(ui.brand_color)) {
      errors.push("agents/openai.yaml interface.brand_color must be a six-digit hex color.");
    }
    for (const key of ["icon_small", "icon_large"]) {
      const value = ui[key];
      const target = typeof value === "string" ? path.resolve(root, value) : null;
      if (!target || !target.startsWith(`${root}${path.sep}`) || !fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
        errors.push(`agents/openai.yaml interface.${key} must reference a file inside the Skill package.`);
      }
    }
  } catch (error) {
    errors.push(`agents/openai.yaml is invalid YAML: ${error.message}`);
  }
}

function validateLinkedResources(root, skillSource, errors, warnings) {
  const linkedFromSkill = new Set(relativeLinks(skillSource).map(normalizeLink));
  const openAiMetadata = path.join(root, "agents", "openai.yaml");
  if (fs.existsSync(openAiMetadata)) {
    try {
      const metadata = YAML.parse(fs.readFileSync(openAiMetadata, "utf8"));
      for (const key of ["icon_small", "icon_large"]) {
        const value = metadata?.interface?.[key];
        if (typeof value === "string" && value.length > 0) {
          linkedFromSkill.add(normalizeLink(path.relative(root, path.resolve(root, value))));
        }
      }
    } catch {
      // agents/openai.yaml parsing errors are reported by validateOpenAiMetadata.
    }
  }
  const expected = [];
  for (const directory of ["references", "scripts", "assets"]) {
    const dir = path.join(root, directory);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) expected.push(`${directory}/${entry.name}`);
    }
  }

  for (const relative of expected) {
    if (!linkedFromSkill.has(relative)) {
      warnings.push(`Resource is not linked directly from SKILL.md: ${relative}`);
    }
  }

  for (const file of walkMarkdown(root)) {
    const content = fs.readFileSync(file, "utf8");
    for (const link of relativeLinks(content)) {
      const normalized = normalizeLink(link);
      const target = path.resolve(path.dirname(file), normalized);
      if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
        errors.push(`Relative link escapes the Skill directory: ${path.relative(root, file)} -> ${link}`);
      } else if (!fs.existsSync(target)) {
        errors.push(`Broken relative link: ${path.relative(root, file)} -> ${link}`);
      }
    }
  }
}

function validateEvals(root, skillName, errors) {
  const file = path.join(root, "evals", "evals.json");
  if (!fs.existsSync(file)) {
    errors.push("Missing evals/evals.json.");
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.skill_name !== skillName) errors.push("evals/evals.json skill_name must match the Skill name.");
    if (!Array.isArray(data.evals) || data.evals.length === 0) {
      errors.push("evals/evals.json must contain at least one eval.");
      return;
    }
    const ids = data.evals.map((entry) => entry.id);
    if (new Set(ids).size !== ids.length) errors.push("evals/evals.json eval IDs must be unique.");
    for (const entry of data.evals) {
      if (!Number.isInteger(entry.id) || typeof entry.prompt !== "string" || entry.prompt.length === 0) {
        errors.push("Every Skill eval requires an integer id and non-empty prompt.");
      }
      if (
        typeof entry.expected_output !== "string"
        || entry.expected_output.trim().length === 0
        || !Array.isArray(entry.expectations)
        || entry.expectations.length === 0
        || entry.expectations.some((expectation) => typeof expectation !== "string" || expectation.trim().length === 0)
      ) {
        errors.push(`Skill eval ${entry.id} requires expected_output and expectations.`);
      }
      if (entry.files !== undefined && !Array.isArray(entry.files)) {
        errors.push(`Skill eval ${entry.id} files must be an array when present.`);
      } else {
        for (const relative of entry.files || []) {
          if (typeof relative !== "string" || relative.length === 0) {
            errors.push(`Skill eval ${entry.id} file entries must be non-empty strings.`);
            continue;
          }
          const target = path.resolve(root, relative);
          if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target)) {
            errors.push(`Skill eval ${entry.id} fixture is missing or escapes the Skill directory: ${relative}`);
            continue;
          }
          try {
            const realRoot = fs.realpathSync(root);
            const realTarget = fs.realpathSync(target);
            if (
              !fs.statSync(realTarget).isFile()
              || !realTarget.startsWith(`${realRoot}${path.sep}`)
            ) {
              errors.push(`Skill eval ${entry.id} fixture must be a regular file inside the Skill directory: ${relative}`);
            }
          } catch (error) {
            errors.push(`Skill eval ${entry.id} fixture cannot be inspected: ${relative}: ${error.message}`);
          }
        }
      }
    }
    validateEvalResults(root, data.evals, skillName, errors);
  } catch (error) {
    errors.push(`evals/evals.json is invalid JSON: ${error.message}`);
  }
}

function validateEvalResults(root, evals, skillName, errors) {
  const evalDir = path.join(root, "evals");
  const resultName = `results-v${PACKAGE_VERSION}.json`;
  const file = path.join(evalDir, resultName);
  if (!fs.existsSync(file)) {
    errors.push(`Skill evals require fresh-session results for package version ${PACKAGE_VERSION}: ${resultName}`);
    return;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${path.basename(file)} is invalid JSON: ${error.message}`);
    return;
  }
  if (!Array.isArray(data.results)) {
    errors.push(`${path.basename(file)} must contain a results array.`);
    return;
  }
  if (data.version !== PACKAGE_VERSION) {
    errors.push(`${resultName} version must match package version ${PACKAGE_VERSION}.`);
  }
  if (data.skill_name !== skillName) {
    errors.push(`${resultName} skill_name must match the Skill name.`);
  }

  const evalIds = evals.map((entry) => entry.id);
  const expectationTotals = new Map(evals.map((entry) => [
    entry.id,
    Array.isArray(entry.expectations) ? entry.expectations.length : null
  ]));
  const resultIds = data.results.map((entry) => entry?.eval_id);
  if (new Set(resultIds).size !== resultIds.length || !sameValues(resultIds, evalIds)) {
    errors.push(`${resultName} must cover every eval ID exactly once.`);
  }

  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const sessionIds = sessions.map((entry) => entry?.id);
  const validSessionIds = sessionIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  if (sessions.length === 0 || validSessionIds.length !== sessions.length) {
    errors.push(`${resultName} must declare non-empty fresh-session IDs.`);
  }
  if (new Set(validSessionIds).size !== validSessionIds.length) {
    errors.push(`${resultName} fresh-session IDs must be unique.`);
  }
  const declaredSessions = new Set(validSessionIds);
  const referencedSessions = new Set();
  const sessionRecords = new Map();
  for (const session of sessions) {
    if (
      typeof session?.id !== "string"
      || typeof session?.artifact !== "string"
      || !/^[a-f0-9]{64}$/.test(session?.sha256 || "")
    ) {
      errors.push(`${resultName} session records require id, artifact, and SHA-256.`);
      continue;
    }
    const target = path.resolve(root, session.artifact);
    try {
      const realRoot = fs.realpathSync(root);
      const realTarget = fs.realpathSync(target);
      if (!realTarget.startsWith(`${realRoot}${path.sep}`) || !fs.statSync(realTarget).isFile()) {
        throw new Error("artifact must be a regular file inside the Skill directory");
      }
      const raw = fs.readFileSync(realTarget);
      const digest = crypto.createHash("sha256").update(raw).digest("hex");
      if (digest !== session.sha256) throw new Error("artifact SHA-256 does not match");
      const record = JSON.parse(raw.toString("utf8"));
      if (record.id !== session.id || record.kind !== "fresh-session-review-record") {
        throw new Error("artifact identity does not match the declared session");
      }
      sessionRecords.set(session.id, record);
    } catch (error) {
      errors.push(`${resultName} session ${session.id} artifact is invalid: ${error.message}`);
    }
  }

  for (const entry of data.results) {
    const expectedTotal = expectationTotals.get(entry?.eval_id);
    if (
      entry?.status !== "pass"
      || !Number.isInteger(entry?.expectations_total)
      || entry.expectations_total !== expectedTotal
      || !Number.isInteger(entry?.expectations_passed)
      || entry.expectations_passed < 0
      || entry.expectations_passed !== entry.expectations_total
    ) {
      errors.push(`${resultName} eval ${entry?.eval_id} does not have complete passing evidence for every defined expectation.`);
    }
    if (typeof entry?.session !== "string" || !declaredSessions.has(entry.session)) {
      errors.push(`${resultName} eval ${entry?.eval_id} must reference a declared fresh-session ID.`);
    } else {
      referencedSessions.add(entry.session);
    }
  }
  for (const sessionId of declaredSessions) {
    if (!referencedSessions.has(sessionId)) {
      errors.push(`${resultName} fresh-session ID is not referenced by any eval result: ${sessionId}`);
    }
    const record = sessionRecords.get(sessionId);
    if (!record) continue;
    const assigned = data.results
      .filter((entry) => entry?.session === sessionId)
      .map((entry) => entry.eval_id);
    const evaluations = Array.isArray(record.evaluations) ? record.evaluations : [];
    const recorded = evaluations.map((entry) => entry?.evalId);
    if (new Set(recorded).size !== recorded.length || !sameValues(recorded, assigned)) {
      errors.push(`${resultName} session ${sessionId} artifact must cover its assigned eval IDs exactly once.`);
      continue;
    }
    for (const evaluation of evaluations) {
      const definition = evals.find((entry) => entry.id === evaluation.evalId);
      const judgments = Array.isArray(evaluation.judgments) ? evaluation.judgments : [];
      if (
        !definition
        || judgments.length !== definition.expectations.length
        || judgments.some((judgment, index) => (
          judgment?.expectation !== definition.expectations[index]
          || judgment?.passed !== true
          || typeof judgment?.evidence !== "string"
          || judgment.evidence.trim().length === 0
        ))
      ) {
        errors.push(`${resultName} session ${sessionId} lacks exact passing judgments for eval ${evaluation.evalId}.`);
      }
    }
  }

  const passed = data.results.filter((entry) => entry?.status === "pass").length;
  const failed = data.results.length - passed;
  if (
    data.summary?.passed !== passed
    || data.summary?.failed !== failed
    || data.summary?.total !== data.results.length
  ) {
    errors.push(`${resultName} summary does not exactly match the recorded eval results.`);
  }
}

function sameValues(left, right) {
  return left.length === right.length
    && [...left].sort((a, b) => a - b).every((value, index) => value === [...right].sort((a, b) => a - b)[index]);
}

function walkMarkdown(root) {
  const files = [path.join(root, "SKILL.md")];
  const referenceDir = path.join(root, "references");
  if (fs.existsSync(referenceDir)) {
    for (const name of fs.readdirSync(referenceDir)) {
      if (name.endsWith(".md")) files.push(path.join(referenceDir, name));
    }
  }
  return files;
}

function relativeLinks(source) {
  const links = [];
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    links.push(raw.split("#")[0]);
  }
  return links;
}

function normalizeLink(link) {
  return link.replaceAll("\\", "/").replace(/^\.\//, "");
}
