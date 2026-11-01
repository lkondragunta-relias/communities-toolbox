import { orgKey } from "../config/orgConfig.js";
import { orgCommandDate, parseOrgCommand, prepareOrgCommand } from "./orgCommands.js";

const normalize = (value) => orgKey(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const unique = (values) => [...new Set(values)];

function similarity(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length, 1);
}

export function matchOrgText(text, entries, keys, allowShort = false) {
  const input = normalize(text);
  const words = input.split(" ");
  const scored = entries.map((entry) => {
    let score = 0;
    let exact = false;
    for (const value of keys.flatMap((key) => Array.isArray(entry[key]) ? entry[key] : [entry[key]])) {
      const name = normalize(value);
      if (!name) continue;
      if (` ${input} `.includes(` ${name} `)) { score = Math.max(score, 1 + name.length / 1000); exact = true; }
      if (allowShort && name.split(" ").some((word) => word.length >= 3 && words.includes(word))) { score = Math.max(score, 1); exact = true; }
      if (allowShort) for (const word of name.split(" ")) {
        for (const inputWord of words) if (word.length >= 4 && inputWord.length >= 4) score = Math.max(score, similarity(inputWord, word));
      }
      for (let size = 1; size <= Math.min(6, words.length); size += 1) {
        for (let start = 0; start + size <= words.length; start += 1) {
          const phrase = words.slice(start, start + size).join(" ");
          if (phrase.length >= 4 && name.length >= 4) score = Math.max(score, similarity(phrase, name));
          if (phrase.length >= 4 && name.length > phrase.length && ` ${name} `.includes(` ${phrase}`)) score = Math.max(score, 0.88);
        }
      }
    }
    return { entry, score, exact };
  }).filter((item) => item.score >= 0.78).sort((a, b) => b.score - a.score);
  if (!scored.length) return { matches: [], exact: false };
  const best = scored[0];
  const matches = scored.filter((item) => best.exact ? item.exact && item.score >= best.score - 0.001 : item.score >= best.score - 0.08);
  return { matches: matches.map((item) => item.entry), exact: best.exact };
}

function optionsFor(field, model) {
  if (field === "target") return model.people.map((person) => ({ value: person.name, label: `${person.name} · ${person.organization}`, matchName: person.name }));
  if (field === "domain") return model.domains.map((domain) => ({ value: domain.id, label: domain.name }));
  if (field === "role") return model.roles.map((role) => ({ value: role.name, label: role.name, aliases: ({
    "Eng leader": ["Engineering leader", "Engineering lead", "Eng lead"],
    PM: ["Product manager", "Product owner"],
    UX: ["UX designer", "User experience"],
    Engineer: ["Developer", "Software engineer"],
    QA: ["Quality assurance", "Tester"],
  })[role.name] || [] }));
  if (field === "team") return model.teams.map((team) => ({ value: team.id, label: team.label }));
  if (field === "organization") return model.organizations.map((organization) => ({ value: organization.name, label: organization.name }));
  return [];
}

function ask(command, field, question, options = [], extra = {}) {
  return { kind: "clarify", command, field, question, options, ...extra };
}

function setField(command, field, value) {
  if (field === "target") return { ...command, target: value, newPerson: false, selectedId: command.target === value ? command.selectedId : undefined };
  if (["target", "domain", "action"].includes(field)) return { ...command, [field]: value };
  return { ...command, changes: { ...command.changes, [field]: value } };
}

function resolveReference(command, field, text, model) {
  if (field === "team" && /^(skip|none|null|blank|no team)$/i.test(text.trim())) return setField(command, field, "");
  const options = optionsFor(field, model);
  if (!options.length) return ask(command, field, `No ${field} choices are available. Refresh after updating the workbook, or type a correction.`);
  const exact = options.filter((option) => normalize(option.value) === normalize(text) || normalize(option.label.split(" · ")[0]) === normalize(text));
  const result = exact.length ? { matches: exact, exact: true } : matchOrgText(text, options, field === "target" ? ["value", "matchName"] : ["value", "label", "aliases"], field === "target" && normalize(text).split(" ").length === 1);
  const values = unique(result.matches.map((option) => option.value));
  if (values.length === 1 && result.exact) return setField(command, field, values[0]);
  const newOption = field === "target" && command.action === "add" ? [{ value: `new person: ${text}`, label: `Create a new person named "${text}"` }] : [];
  return ask(command, field, values.length ? `Did you mean ${field === "target" ? "this person" : `this ${field}`}? Choose a match, or type a different value.` : `Which ${field === "target" ? "person" : field} do you mean? Type a name or choose below.`,
    [...(values.length ? result.matches : options), ...newOption], { suggested: true });
}

function extractDates(text, command, now) {
  const pattern = /\b(start(?:ing|s)?(?:\s+date)?|end(?:ing|s)?(?:\s+date)?)\s*(?:[:=]\s*|(?:from|on|to|is)\s+)?(.+?)(?=\s*(?:;|\n|\band\b|\bstart(?:ing|s)?\b|\bend(?:ing|s)?\b)|$)/ig;
  const changes = { ...command.changes };
  for (const match of text.matchAll(pattern)) {
    const field = /^start/i.test(match[1]) ? "startDate" : "endDate";
    const raw = match[2].trim().replace(/[,.!?]+$/, "");
    const datePrefix = raw.match(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?|[a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+\.?(?:\s+\d{4})?)(?=\s|,|$)/i);
    try { changes[field] = orgCommandDate(datePrefix?.[1] || raw, now); }
    catch (err) { return ask({ ...command, changes }, field, `${err.message} What ${field === "startDate" ? "start" : "end"} date should I use? You can also say "null".`); }
  }
  return { ...command, changes };
}

function settle(command, model) {
  if (!command.action) return ask(command, "action", "Do you want to add, update, or remove an assignment?",
    [{ value: "add", label: "Add assignment" }, { value: "update", label: "Update assignment" }, { value: "remove", label: "Remove assignment" }]);
  for (const field of ["target", ...(["add", "remove"].includes(command.action) ? ["domain"] : [])]) {
    if (!command[field]) return ask(command, field, `Which ${field === "target" ? "person" : "domain"} should I use?`, optionsFor(field, model));
  }
  if (!command.newPerson && !/^(assignment |open |team allocation$|ux none$)/i.test(command.target)) {
    const person = resolveReference(command, "target", command.target, model);
    if (person.kind) return person;
    command = person;
  }
  if (command.domain) {
    const domain = resolveReference(command, "domain", command.domain, model);
    if (domain.kind) return domain;
    command = domain;
  }
  for (const field of ["role", "team", "organization"]) {
    if (!command.changes[field]) continue;
    const resolved = resolveReference(command, field, command.changes[field], model);
    if (resolved.kind) return resolved;
    command = resolved;
  }
  try {
    const sameNamed = model.people.filter((person) => orgKey(person.name) === orgKey(command.target));
    if (command.action === "add" && !command.changes.organization && sameNamed.length > 1) return ask(command, "organization",
      "That full name belongs to more than one directory identity. Which organization should I use?",
      unique(sameNamed.map((person) => person.organization)).map((value) => ({ value, label: value })));
    const result = prepareOrgCommand(command, model, command.selectedId);
    if (result.kind === "clarify") return ask(command, result.field, result.question,
      result.options.map((value) => ({ value, label: optionsFor(result.field, model).find((option) => option.value === value)?.label || value })));
    return { ...result, command };
  } catch (err) {
    return ask(command, "correction", `${err.message} Tell me what to correct (for example "role PM", "domain Wound Care", "start October 12"), or say "cancel".`);
  }
}

export function orgConversationTurn(input, pending, model, now = new Date()) {
  const text = String(input || "").trim();
  if (!text || text.length > 2000) return ask(pending?.command || { changes: {} }, "correction", "Enter a request or reply up to 2,000 characters.");
  if (/^(cancel|start over|reset)$/i.test(text)) return { kind: "cancelled" };
  let command = pending?.kind === "clarify" || pending?.kind === "choose" ? { ...pending.command, changes: { ...pending.command.changes } } : { action: "", target: "", domain: "", changes: {} };
  if (/\b(don't|do not|not|except|instead of)\b/i.test(text) && !/\bnot applicable\b/i.test(text)) {
    return ask(command, "correction", "I don't want to reverse your intent. Please describe only the person, domain, and values you do want to apply; your previous details are kept.");
  }
  if (/\b(all people|everyone|bulk|all assignments)\b/i.test(text) || (text.match(/\b(add|assign|update|edit|remove|delete)\b/ig) || []).length > 1) {
    return ask(command, "correction", "I can safely change or remove one assignment at a time, not perform bulk requests. Describe one assignment, or say 'cancel' to start over.");
  }
  if (!pending || pending.kind === "preview") {
    const namedPeople = unique(model.people.filter((person) => ` ${normalize(text)} `.includes(` ${normalize(person.name)} `)).map((person) => person.name));
    if (namedPeople.length > 1 && !/\bname\b/i.test(text)) return ask(command, "correction",
      "I found more than one person in this request. Please describe one assignment at a time so I don't update the wrong person.");
  }
  if (pending?.kind === "clarify" && pending.field !== "correction") {
    const option = pending.options.find((item) => normalize(item.value) === normalize(text) || normalize(item.label) === normalize(text));
    if (option) return chooseOrgConversation(pending, option.value, model);
    if (["startDate", "endDate"].includes(pending.field)) {
      try { return settle(setField(command, pending.field, orgCommandDate(text, now)), model); }
      catch (err) { return ask(command, pending.field, `${err.message} Please try that date again, or say "null".`); }
    }
    if (pending.field === "action") {
      if (/\b(remove|delete)\b/i.test(text)) return settle(setField(command, "action", "remove"), model);
      if (/\b(add|assign)\b/i.test(text)) return settle(setField(command, "action", "add"), model);
      if (/\b(update|edit|change|end)\b/i.test(text)) return settle(setField(command, "action", "update"), model);
    } else {
      const dated = extractDates(text, command, now);
      if (dated.kind) return dated;
      command = dated;
      for (const field of ["domain", "role", "team", "organization"]) {
        if (field === pending.field) continue;
        if (field === "team" && !/\bteam\b/i.test(text)) continue;
        const found = matchOrgText(text, optionsFor(field, model), ["value", "label", "aliases"]);
        if (found.exact && found.matches.length === 1) command = setField(command, field, found.matches[0].value);
      }
      const result = resolveReference(command, pending.field, text, model);
      return result.kind ? result : settle(result, model);
    }
  }
  if (pending?.kind === "choose") {
    const matches = pending.candidates.filter((row, index) => text === String(index + 1) || text === row.id ||
      (normalize(text) === normalize(row.domainName) && pending.candidates.filter((item) => item.domain === row.domain).length === 1));
    if (matches.length === 1) return settle({ ...command, selectedId: matches[0].id }, model);
    return { ...pending, question: "Choose the exact assignment below, or reply with its number." };
  }
  if (pending?.field === "correction") {
    try {
      if (/^(?:please\s+)?(?:add|assign|update|edit|remove|delete)\s+/i.test(text)) return settle(parseOrgCommand(text, now), model);
      const correction = parseOrgCommand(`update ${command.target || "Person"}: ${text}`, now);
      return settle({ ...command, changes: { ...command.changes, ...correction.changes } }, model);
    } catch (err) { return ask(command, "correction", `${err.message} Your previous details are still kept. Try a field and value, or say "cancel".`); }
  }
  try {
    const parsed = parseOrgCommand(text, now);
    return settle(parsed, model);
  } catch (err) {
    // A sentence may arrange its known entities freely; never treat a parser failure as a save.
    command.action = /\b(remove|delete)\b/i.test(text) ? "remove" : /\b(add|assign|include)\b/i.test(text) ? "add" : /\b(update|edit|change|end|set)\b/i.test(text) ? "update" : "";
    for (const field of ["target", "domain", "role", "organization", "team"]) {
      if (field === "team" && !/\bteam\b/i.test(text)) continue;
      const result = matchOrgText(text, optionsFor(field, model), field === "target" ? ["value", "matchName"] : ["value", "label", "aliases"], field === "target");
      if (result.matches.length === 1 && result.exact) command = setField(command, field, result.matches[0].value);
      else if (result.matches.length) command = setField(command, field, text);
    }
    const labeled = /\b(name|person|domain|role|team|organization|partner)\s*[:=]\s*(.+?)(?=\s*(?:[,;\n]|\b(?:name|person|domain|role|team|organization|partner|start|end)\s*[:=])|$)/ig;
    for (const match of text.matchAll(labeled)) {
      const field = { name: "target", person: "target", partner: "organization" }[orgKey(match[1])] || orgKey(match[1]);
      command = setField(command, field, match[2].trim());
    }
    const dated = extractDates(text, command, now);
    if (dated.kind) return dated;
    // An unrecognized explicit field must be supplied again, not silently omitted.
    if (/\b(notes|rename|status)\b/i.test(text)) return ask(dated, "correction", `${err.message} Please give the unclear field as "notes ...", "name ...", or "status ..."; I have kept the other details.`);
    return settle(dated, model);
  }
}

export function chooseOrgConversation(pending, value, model) {
  if (pending.kind === "choose") return settle({ ...pending.command, selectedId: value }, model);
  if (pending.field === "target" && value.startsWith("new person: ")) return settle({ ...pending.command, target: value.slice(12), newPerson: true }, model);
  return settle(setField(pending.command, pending.field, value), model);
}
