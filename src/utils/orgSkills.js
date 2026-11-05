import { orgKey, personKey } from "../config/orgConfig.js";

export const WORK_FOCUS = ["Frontend", "Backend", "Full-stack", "QA automation"];
export const validGitHubUsername = (value) => !value || /^(?!.*--)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value);
export const plainSkillText = (value) => Boolean(value.trim()) && value.length <= 100 && !/^[=+@-]/.test(value.trim());

export function profileSnapshot(person) {
  return {
    workFocus: person?.workFocus || "",
    githubUsername: person?.githubUsername || "",
    skillIds: [...(person?.skillIds || [])].sort(),
  };
}

export function resolveOrgSkills(source, assignments) {
  const skills = [];
  const profiles = [];
  const personSkills = [];
  const issues = [];
  const people = new Set(assignments.filter((row) => row.personName && row.personId).map((row) => row.personId));
  for (const entry of source.skills || []) {
    if (!entry.id || !plainSkillText(String(entry.name || "")) || skills.some((skill) => skill.id === entry.id || orgKey(skill.name) === orgKey(entry.name))) {
      issues.push("Skills Catalog: each skill needs a unique ID and plain-text name.");
    } else skills.push({ id: entry.id, name: entry.name.trim() });
  }
  for (const entry of source.profiles || []) {
    if (!people.has(entry.personId) || profiles.some((profile) => profile.personId === entry.personId) ||
      (entry.workFocus && !WORK_FOCUS.includes(entry.workFocus)) || !validGitHubUsername(entry.githubUsername || "")) {
      issues.push("People Profiles: check Person ID, duplicate profiles, work focus, and GitHub username.");
    } else profiles.push({ personId: entry.personId, workFocus: entry.workFocus || "", githubUsername: entry.githubUsername || "" });
  }
  for (const entry of source.personSkills || []) {
    if (!people.has(entry.personId) || !skills.some((skill) => skill.id === entry.skillId) ||
      personSkills.some((link) => link.personId === entry.personId && link.skillId === entry.skillId)) {
      issues.push("Person Skills: use existing Person IDs and Skill IDs, with no duplicate pairs.");
    } else personSkills.push({ personId: entry.personId, skillId: entry.skillId });
  }
  return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)), profiles, personSkills, issues: [...new Set(issues)] };
}

export function enrichOrgPerson(person, source) {
  const profile = source.profiles.find((entry) => entry.personId === person.key);
  const skillIds = source.personSkills.filter((entry) => entry.personId === person.key).map((entry) => entry.skillId);
  return {
    ...person, workFocus: profile?.workFocus || "", githubUsername: profile?.githubUsername || "",
    skillIds, skills: source.skills.filter((skill) => skillIds.includes(skill.id)),
  };
}

export function matchesOrgSkills(row, selectedSkills, personSkills) {
  return !selectedSkills.length || Boolean(row.personName && selectedSkills.some((skillId) =>
    personSkills.some((link) => link.personId === personKey(row) && link.skillId === skillId)));
}

export function validatePersonProfile(entry, org) {
  if (!org.assignments.some((row) => row.personId === entry.personId && row.personName)) return "This person needs an existing Person ID in the assignment sheet.";
  if (entry.workFocus && !WORK_FOCUS.includes(entry.workFocus)) return "Choose a configured work focus.";
  if (!validGitHubUsername(entry.githubUsername || "")) return "Enter a GitHub username, not a URL.";
  if (!Array.isArray(entry.skillIds) || new Set(entry.skillIds).size !== entry.skillIds.length ||
    entry.skillIds.some((id) => !org.skills.some((skill) => skill.id === id))) return "Choose unique skills from the current catalog.";
  return "";
}
