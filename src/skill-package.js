import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { repoRoot } from "./fs-utils.js";

export const CANONICAL_SKILL_DIR = path.join(repoRoot, "skills", "loop-engineering");
export const SKILL_PLATFORMS = new Set(["codex", "claude-code"]);

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

  const extraMetadataKeys = Object.keys(metadata).filter((key) => key !== "name" && key !== "description");
  const installedByGitHub = extraMetadataKeys.length === 1
    && extraMetadataKeys[0] === "metadata"
    && validGitHubInstallMetadata(metadata.metadata);
  if (extraMetadataKeys.length > 0 && !installedByGitHub) {
    errors.push("SKILL.md frontmatter must contain only name and description, except GitHub CLI source-tracking metadata on installed copies.");
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
  return Object.keys(value).every((key) => required.includes(key))
    && required.every((key) => typeof value[key] === "string" && value[key].length > 0);
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
  } catch (error) {
    errors.push(`agents/openai.yaml is invalid YAML: ${error.message}`);
  }
}

function validateLinkedResources(root, skillSource, errors, warnings) {
  const linkedFromSkill = new Set(relativeLinks(skillSource).map(normalizeLink));
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
      if (typeof entry.expected_output !== "string" || !Array.isArray(entry.expectations) || entry.expectations.length === 0) {
        errors.push(`Skill eval ${entry.id} requires expected_output and expectations.`);
      }
      if (entry.files !== undefined && !Array.isArray(entry.files)) {
        errors.push(`Skill eval ${entry.id} files must be an array when present.`);
      }
    }
  } catch (error) {
    errors.push(`evals/evals.json is invalid JSON: ${error.message}`);
  }
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
