import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateSkill, validateSkills } from "./validate-skill-frontmatter.mjs";

const valid = (description = "V1.0 - Test when asked.") =>
  `---\nname: feedback-pipeline\ndescription: '${description}'\ncompatibility: Node.js 22+\n---\n# Skill\n`;

test("repository skills parse as real YAML, meet policy and are cataloged", () => {
  const files = validateSkills();
  assert.ok(files.includes(".github/skills/feedback-pipeline/SKILL.md"));
  const fields = validateSkill(readFileSync(files[0], "utf8"), "feedback-pipeline");
  assert.equal(fields.name, "feedback-pipeline");
  assert.equal(fields.description, "V1.0 - Turn Communities Toolbox feedback into deduplicated GitHub issues, coordinate local fix sessions and PRs, request approval for data corrections, and sync sheet status during the Project's daily run.");
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(".github/skills/feedback-pipeline/SKILL.md"));
});

test("frontmatter rejects YAML errors, duplicate fields and invalid names/types/limits", () => {
  for (const text of [
    valid().replace("description: 'V1.0 - Test when asked.'", "description: V1.0 - mentions: invalid"),
    valid().replace("name: feedback-pipeline", "name: Feedback-Pipeline"),
    valid().replace("name: feedback-pipeline", "name: feedback--pipeline"),
    valid().replace("compatibility: Node.js 22+", "compatibility: 22"),
    valid().replace("compatibility: Node.js 22+", ""),
    valid().replace("---\n# Skill", "name: duplicate\n---\n# Skill"),
    valid("Test without version"), valid(`V1.0 - ${"x".repeat(1024)}`),
    "no frontmatter",
  ]) assert.throws(() => validateSkill(text, "feedback-pipeline"));
  assert.doesNotThrow(() => validateSkill(valid(`V1.0 - ${"x".repeat(1017)}`), "feedback-pipeline"));
  assert.throws(() => validateSkill(valid(), "other-directory"));
});
