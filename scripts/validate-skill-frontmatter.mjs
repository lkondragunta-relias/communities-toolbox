import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDocument } from "yaml";

export function validateSkill(text, directory) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error("Missing YAML frontmatter delimiters");
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.map((error) => error.message).join("; "));
  const fields = document.toJS();
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Frontmatter must be a map");
  for (const [field, maximum] of [["name", 64], ["description", 1024], ["compatibility", 500]]) {
    if (typeof fields[field] !== "string" || !fields[field].trim() || fields[field].length > maximum) {
      throw new Error(`Invalid ${field}`);
    }
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name) || fields.name !== directory) throw new Error("Invalid skill name/directory");
  if (!/^V\d+\.\d+ - \S/.test(fields.description) || /[\r\n]/.test(fields.description)) throw new Error("Invalid versioned description");
  const allowed = ["name", "description", "compatibility", "license", "metadata", "allowed-tools"];
  if (Object.keys(fields).some((field) => !allowed.includes(field))) throw new Error("Unknown frontmatter field");
  for (const field of ["license", "allowed-tools"]) {
    if (fields[field] !== undefined && typeof fields[field] !== "string") throw new Error(`Invalid ${field}`);
  }
  if (fields.metadata !== undefined && (!fields.metadata || typeof fields.metadata !== "object" ||
      Array.isArray(fields.metadata) || Object.values(fields.metadata).some((value) => typeof value !== "string"))) {
    throw new Error("Invalid metadata");
  }
  return fields;
}

export function validateSkills(root = ".github/skills") {
  const files = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name === "SKILL.md") files.push(file);
    }
  };
  visit(root);
  if (!files.length) throw new Error("No repository skills found");
  for (const file of files) {
    try { validateSkill(readFileSync(file, "utf8"), basename(dirname(file))); }
    catch (err) { throw new Error(`${file}: ${err.message}`); }
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`Validated ${validateSkills().length} repository skill(s).`); }
  catch (err) { console.error(err.message); process.exitCode = 1; }
}
