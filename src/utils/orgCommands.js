import { ORG_FIELDS, orgKey, validOrgDate, validateOrgAssignment } from "../config/orgConfig.js";

export const ORG_COMMAND_FIELDS = {
  domain: "Domain", personName: "Person name", role: "Role", team: "Team",
  organization: "Organization", status: "Status", notes: "Notes",
  startDate: "Start date", endDate: "End date",
};

const aliases = {
  domain: "domain", name: "personName", "person name": "personName",
  role: "role", team: "team", organization: "organization", partner: "organization",
  status: "status", "position status": "status", notes: "notes",
  start: "startDate", "start date": "startDate", end: "endDate", "end date": "endDate",
};
const unquote = (value) => value.trim().replace(/^"([^"]*)"$/, "$1").trim();
const empty = (value) => ["blank", "clear", "no limit", "null", "none", "no end date", "no start date"].includes(orgKey(value));
const cleanRow = (row) => Object.fromEntries(ORG_FIELDS.map((field) => [field, String(row?.[field] || "").trim()]));
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function orgCommandDate(value, now = new Date()) {
  const text = orgKey(unquote(value)).replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, "").replace(/\s+/g, " ");
  if (empty(text) || !text) return "";
  let year = now.getFullYear();
  let month;
  let day;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const named = text.match(/^([a-z]+)\.?\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  const reversed = text.match(/^(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?$/);
  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
  if (iso) [, year, month, day] = iso;
  else if (named || reversed) {
    const word = named ? named[1] : reversed[2];
    const index = MONTHS.findIndex((name) => name === word || name.slice(0, 3) === word || (name === "september" && word === "sept"));
    if (index < 0) throw new Error(`Unknown month "${word}". Spell the month name, such as October 12.`);
    month = index + 1;
    day = named ? named[2] : reversed[1];
    year = (named ? named[3] : reversed[3]) || year;
  } else if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    if (first <= 12 && second <= 12 && first !== second) throw new Error(`Date "${value}" could mean month/day or day/month. Spell the month, such as October 12.`);
    [month, day] = first > 12 ? [second, first] : [first, second];
    year = numeric[3] || year;
  } else throw new Error(`I couldn't read date "${value}". Use October 12th, 12 Oct, or YYYY-MM-DD. If you omit the year, I use ${year}.`);
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!validOrgDate(date)) throw new Error(`"${value}" is not a valid calendar date. Check the day, month, and year.`);
  return date;
}

function parts(input) {
  const result = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === '"') quoted = !quoted;
    if (input[index] === ";" && !quoted) { result.push(input.slice(start, index).trim()); start = index + 1; }
  }
  if (quoted) throw new Error("Close the double quote in your command.");
  result.push(input.slice(start).trim());
  if (result.some((part) => !part)) throw new Error("Each semicolon must be followed by a field and value.");
  return result;
}

function fields(clauses) {
  const changes = {};
  for (const clause of clauses) {
    const match = clause.match(/^(person name|position status|start date|end date|organization|partner|domain|status|notes|start|end|name|role|team)\s*(?:=|:|\s)\s*(.+)$/i);
    if (!match) throw new Error(`I couldn't read "${clause}". Use a field and value, such as "start 2026-12-15". Separate fields with semicolons.`);
    const field = aliases[orgKey(match[1])];
    if (Object.hasOwn(changes, field)) throw new Error(`Specify ${ORG_COMMAND_FIELDS[field].toLowerCase()} only once.`);
    const value = unquote(match[2]);
    if (!value) throw new Error(`Provide a ${ORG_COMMAND_FIELDS[field].toLowerCase()} value, or use "blank" to clear it.`);
    changes[field] = empty(value) ? "" : value;
  }
  return changes;
}

function conversationalParts(text) {
  // Delimit only recognizable field clauses outside quotes, not words inside names or notes.
  const pattern = /(?:\s*[,;\n]\s*|\s+and\s+)(?=(?:(?:set|change)\s+(?:the\s+)?)?(?:starting|starts?|start date|ending|ends?|end date|role|team|organization|partner|status|notes|name|domain)\s+)|\s+(?=(?:starting|ending|starts|ends)\s+)/iy;
  let quoted = false;
  let start = 0;
  const result = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') quoted = !quoted;
    if (quoted) continue;
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (match?.index === index && index > start) {
      result.push(text.slice(start, index).trim());
      start = index + match[0].length;
      index = start - 1;
    }
  }
  if (quoted) throw new Error("Close the double quote in your command.");
  result.push(text.slice(start).trim());
  return result;
}

function conversationalField(clause) {
  return clause.replace(/^(?:set|change)\s+(?:the\s+)?/i, "")
    .replace(/^starting(?:\s+(?:from|on))?\s+/i, "start ")
    .replace(/^starts?(?:\s+(?:from|on))?\s+/i, "start ")
    .replace(/^ending(?:\s+(?:on|from))?\s+/i, "end ")
    .replace(/^ends?(?:\s+on)?\s+/i, "end ")
    .replace(/^(person name|position status|start date|end date|organization|partner|domain|status|notes|start|end|name|role|team)\s+(?:to|is|on|from)\s+/i, "$1 ");
}

function conversationalCommand(text) {
  const set = text.match(/^(?:set|change)\s+(.+?)(?:'s|’s)\s+(start date|end date|role|team|organization|name|notes|status|domain)\s+to\s+(.+)$/i);
  if (set) return { action: "update", target: unquote(set[1]), domain: "", changes: fields([`${set[2]} ${set[3]}`]) };
  const [head, ...tail] = conversationalParts(text);
  const changes = fields(tail.map(conversationalField));
  const add = head.match(/^(?:add|assign)\s+(.+?)\s+(?:for|to|in)\s+(.+?)(?:\s+as\s+(.+))?$/i);
  const roleFirst = head.match(/^(?:add|assign)\s+(.+?)\s+as\s+(.+?)\s+(?:for|to|in)\s+(.+)$/i);
  if (roleFirst || add) {
    const role = roleFirst ? roleFirst[2] : add[3];
    if (role && changes.role) throw new Error("Specify the role only once.");
    return { action: "add", target: unquote((roleFirst || add)[1]), domain: unquote(roleFirst ? roleFirst[3] : add[2]), changes: { ...changes, ...(role ? { role: unquote(role) } : {}) } };
  }
  const update = head.match(/^(?:update|change|edit)\s+(.+?)(?:\s+(?:in|for|on)\s+(.+))?$/i);
  if (update && tail.length) return { action: "update", target: unquote(update[1]), domain: unquote(update[2] || ""), changes };
  throw new Error('I need a person, an action, and a domain or field to change. For example: "Please add Janaky for Wound Care, starting from October 12th" or "Update Matt in Recruiting, end date December 31". I handle one assignment per message.');
}

export function parseOrgCommand(input, now = new Date()) {
  const text = String(input || "").trim()
    .replace(/^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?/i, "").replace(/[.!?]$/, "");
  if (!text || text.length > 2000) throw new Error("Enter one command, up to 2,000 characters.");
  const command = parseCommandText(text);
  for (const field of ["startDate", "endDate"]) {
    if (Object.hasOwn(command.changes, field)) command.changes[field] = orgCommandDate(command.changes[field], now);
  }
  return command;
}

function parseCommandText(text) {
  const [head, ...clauses] = parts(text);
  const removal = head.match(/^(?:remove|delete)\s+(.+?)\s+(?:from|in|on)\s+(.+)$/i);
  if (removal && !clauses.length) {
    const scoped = removal[2].match(/^(.+?)\s+(?:on|in|for)\s+(.+)$/i);
    return { action: "remove", target: unquote(removal[1]), domain: unquote(scoped ? scoped[2] : removal[2]), changes: scoped ? { role: unquote(scoped[1]) } : {} };
  }
  const update = head.match(/^update\s+(.+?)(?:\s+in\s+(.+?))?\s*:\s*(.+)$/i);
  if (update) return { action: "update", target: unquote(update[1]), domain: unquote(update[2] || ""), changes: fields([update[3], ...clauses].flatMap(conversationalParts).map(conversationalField)) };
  const end = head.match(/^end\s+(.+?)(?:\s+(?:in|for)\s+(.+?))?\s+on\s+(.+)$/i);
  if (end && !clauses.length) return { action: "update", target: unquote(end[1]), domain: unquote(end[2] || ""), changes: { endDate: end[3] } };
  if (conversationalParts(head).length > 1) return conversationalCommand(text);
  const naturalAdd = head.match(/^(?:add|assign)\s+(.+?)\s+as\s+(.+?)\s+(?:for|to|in)\s+(.+)$/i);
  const assign = naturalAdd ? [naturalAdd[0], naturalAdd[1], naturalAdd[3], naturalAdd[2]] : head.match(/^assign\s+(.+?)\s+to\s+(.+?)\s+as\s+(.+)$/i);
  if (assign) {
    const changes = fields(clauses);
    if (["personName", "domain", "role"].some((field) => Object.hasOwn(changes, field))) throw new Error("Put the person, domain, and role in the 'assign ... to ... as ...' part only.");
    return { action: "add", target: unquote(assign[1]), domain: unquote(assign[2]), changes: { ...changes, role: unquote(assign[3]) } };
  }
  return conversationalCommand(text);
}

function reference(value, entries, label, names, allowBlank = false) {
  if (!value && allowBlank) return "";
  const matches = entries.filter((entry) => names.some((name) => orgKey(entry[name]) === orgKey(value)));
  if (matches.length !== 1) throw new Error(`${label} "${value}" ${matches.length ? "is ambiguous" : "was not found"}. Use an exact configured name${label === "Domain" || label === "Team" ? " or ID" : ""}.`);
  return matches[0][names[0]];
}

function resolveFields(changes, model) {
  const result = { ...changes };
  if (Object.hasOwn(result, "domain")) result.domain = reference(result.domain, model.domains, "Domain", ["id", "name"]);
  if (Object.hasOwn(result, "team")) result.team = reference(result.team, model.teams, "Team", ["id", "label"], true);
  if (Object.hasOwn(result, "role")) result.role = reference(result.role, model.roles, "Role", ["name"]);
  if (Object.hasOwn(result, "organization")) result.organization = reference(result.organization, model.organizations, "Organization", ["name"], true);
  if (Object.hasOwn(result, "status")) {
    result.status = reference(result.status, [{ name: "Assigned" }, { name: "Open" }, { name: "Not applicable" }], "Status", ["name"]);
  }
  for (const field of ["startDate", "endDate"]) {
    if (result[field] && !validOrgDate(result[field])) throw new Error(`${ORG_COMMAND_FIELDS[field]} must be a valid calendar date. Use "blank" for no time limit.`);
  }
  return result;
}

function identifyPerson(row, model) {
  if (!row.personName) return { ...row, personId: "" };
  const matches = model.assignments.filter((entry) => entry.personName && orgKey(entry.personName) === orgKey(row.personName) && orgKey(entry.organization) === orgKey(row.organization));
  const ids = new Set(matches.map((entry) => entry.personId).filter(Boolean));
  if (row.personId && matches.some((entry) => entry.personId === row.personId)) return row;
  if (ids.size > 1) throw new Error("Several people have that exact name and organization. Edit the specific person using their assignment pill instead.");
  return { ...row, personId: [...ids][0] || "" };
}

function clarification(field, options, question) {
  if (!options.length) throw new Error(`No ${ORG_COMMAND_FIELDS[field].toLowerCase()} options are configured. Add them in the workbook before continuing.`);
  return { kind: "clarify", field, options: [...new Set(options)], question };
}

export function prepareOrgCommand(command, model, selectedId) {
  const changes = resolveFields({ startDate: "", endDate: "", ...command.changes }, model);
  const domain = command.domain ? reference(command.domain, model.domains, "Domain", ["id", "name"]) : "";
  let before = null;
  let row;
  if (command.action === "add") {
    const eligible = model.people.filter((person) => !changes.organization || person.organization === changes.organization);
    const exact = eligible.filter((person) => orgKey(person.name) === orgKey(command.target));
    const known = exact.length ? exact : eligible.filter((person) => orgKey(person.name).split(/\s+/).includes(orgKey(command.target)));
    if (known.length > 1) throw new Error("Several people match that name. Use the full person name and specify their organization.");
    const organizations = new Set(known.map((person) => person.organization));
    if (!Object.hasOwn(changes, "organization") && organizations.size !== 1) return clarification("organization",
      model.organizations.map((organization) => organization.name), `Which organization or partner does ${command.target} belong to?`);
    if (!changes.role) {
      const roles = [...new Set(known.flatMap((person) => person.assignments.map((entry) => entry.role)))];
      if (roles.length === 1) changes.role = roles[0];
      else return clarification("role", model.roles.filter((role) => role.category !== "Team & Partners").map((role) => role.name),
        `Which role should ${known[0]?.name || command.target} have in ${command.domain}?`);
    }
    row = { ...cleanRow(), domain, personName: known[0]?.name || command.target, status: "Assigned", organization: [...organizations][0] || "", ...changes };
  } else {
    const target = orgKey(command.target);
    const candidates = model.assignments.filter((entry) => {
      if (domain && entry.domain !== domain) return false;
      if (command.action === "remove" && changes.role && entry.role !== changes.role) return false;
      if (target === "team allocation") return entry.category === "Team & Partners";
      if (target === "ux none") return entry.status === "Not applicable" && entry.category === "UX";
      if (target.startsWith("open ")) return entry.status === "Open" && orgKey(entry.role) === target.slice(5);
      if (target.startsWith("assignment ")) return entry.id === command.target.slice(11).trim();
      return entry.personName && (orgKey(entry.personName) === target || orgKey(entry.personName).split(/\s+/).some((word) => word === target));
    });
    if (!candidates.length) throw new Error("No matching assignment was found. Use the person's full name and an exact domain name. Commands search all dates, regardless of the page filters.");
    if (candidates.length > 1 && !selectedId) return { kind: "choose", candidates };
    const matches = selectedId ? candidates.filter((entry) => entry.id === selectedId) : candidates;
    if (matches.length !== 1) throw new Error("That assignment is no longer uniquely available. Submit your command again after refreshing.");
    before = cleanRow(matches[0]);
    if (command.action === "remove") return { kind: "preview", action: "remove", before, row: before, differences: [] };
    row = { ...before, ...changes };
    if (row.personName !== before.personName || row.organization !== before.organization) row.personId = "";
  }
  // Status/category changes must not silently discard an assigned person.
  row = identifyPerson(row, model);
  const message = validateOrgAssignment(row, model);
  if (message) throw new Error(message);
  const differences = Object.keys(ORG_COMMAND_FIELDS).filter((field) => !before || before[field] !== row[field])
    .map((field) => ({ field, before: before?.[field] || "", after: row[field] }));
  if (!differences.length) throw new Error("That assignment already has these values. Nothing needs saving.");
  return { kind: "preview", before, row, differences };
}

export function validateOrgCommandPreview(preview, model) {
  if (preview.before) {
    const matches = model.assignments.filter((row) => row.id === preview.before.id);
    if (matches.length !== 1 || ORG_FIELDS.some((field) => String(matches[0][field] || "") !== preview.before[field])) {
      throw new Error("This assignment changed after your preview. Submit the command again to review the latest values.");
    }
    if (preview.action === "remove") {
      if (!preview.before || preview.row.id !== preview.before.id) throw new Error("Select an exact existing assignment before removing it.");
      return cleanRow(preview.before);
    }
  }
  const row = identifyPerson(preview.row, model);
  const message = validateOrgAssignment(row, model);
  if (message) throw new Error(message);
  return row;
}
