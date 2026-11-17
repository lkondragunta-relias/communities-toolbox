export const MILESTONE_VERSION = 1;
export const MILESTONE_STATUSES = ["Completed", "Planned"];
export const MILESTONE_LIMITS = { title: 160, impact: 300, details: 5000, links: 8, domainIds: 30 };
export const MILESTONE_ACTIONS = ["addMilestone", "updateMilestone", "deleteMilestone"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^MS-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isMilestoneLink(link) {
  if (typeof link !== "string" || link.length > 1000 || /[\s\\<>"`]/.test(link) ||
      [...link].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return false;
  const match = /^https:\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#].*)?$/i.exec(link);
  return Boolean(match && match[1].length <= 253 && (!match[2] || Number(match[2]) <= 65535) &&
    match[1].split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)));
}

export function isMilestoneDate(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function isMilestoneTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function text(value, field, required) {
  if (typeof value !== "string" || value.length > MILESTONE_LIMITS[field]) {
    throw new Error(`Invalid ${field}. Maximum ${MILESTONE_LIMITS[field]} characters.`);
  }
  const result = value.trim();
  if (required && !result) throw new Error(`${field === "title" ? "Title" : "Impact"} is required.`);
  if ([...value].some(c => c.charCodeAt(0) < 32 && !"\t\n\r".includes(c) || c.charCodeAt(0) === 127) ||
      /^[=+\-@']/.test(result)) {
    throw new Error(`${field} must be plain text and cannot start with =, +, -, @ or an apostrophe.`);
  }
  return result;
}

export function validateMilestoneFields(input, domains) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid milestone.");
  if (!Array.isArray(input.domainIds) || !input.domainIds.length ||
      input.domainIds.length > MILESTONE_LIMITS.domainIds ||
      input.domainIds.some(id => typeof id !== "string" || !domains.some(d => d.id === id)) ||
      new Set(input.domainIds).size !== input.domainIds.length) {
    throw new Error("Choose one or more distinct roadmap domains.");
  }
  if (!isMilestoneDate(input.date)) throw new Error("Enter a real calendar date as YYYY-MM-DD.");
  if (!MILESTONE_STATUSES.includes(input.status)) throw new Error("Choose Completed or Planned.");
  const links = input.links === undefined ? [] : input.links;
  if (!Array.isArray(links) || links.length > MILESTONE_LIMITS.links ||
      links.some(link => !isMilestoneLink(link))) {
    throw new Error("Use up to 8 HTTPS evidence URLs, each at most 1,000 characters, without credentials or spaces.");
  }
  return {
    domainIds: [...input.domainIds].sort(), title: text(input.title, "title", true),
    date: input.date, status: input.status, impact: text(input.impact, "impact", true),
    details: text(input.details === undefined ? "" : input.details, "details", false), links: [...new Set(links)],
  };
}

export function validateMilestoneRequest(body, domains) {
  if (!body || !MILESTONE_ACTIONS.includes(body.action)) throw new Error("Invalid milestone action.");
  const deleting = body.action === "deleteMilestone";
  const adding = body.action === "addMilestone";
  const allowed = ["action", "adminToken", "requestId", ...(!adding ? ["id", "expectedUpdatedAt"] : []),
    ...(!deleting ? ["domainIds", "title", "date", "status", "impact", "details", "links"] : [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error("Unexpected milestone field.");
  if (typeof body.requestId !== "string" || !UUID.test(body.requestId)) throw new Error("Invalid milestone request ID.");
  if (!adding && (!ID.test(body.id) || !isMilestoneTimestamp(body.expectedUpdatedAt))) {
    throw new Error("A milestone ID and expected revision are required. Refresh before editing.");
  }
  return {
    action: body.action, requestId: body.requestId.toLowerCase(),
    ...(!adding ? { id: body.id, expectedUpdatedAt: body.expectedUpdatedAt } : {}),
    ...(!deleting ? validateMilestoneFields(body, domains) : {}),
  };
}

export function validateMilestoneReceipt(result, request) {
  if (result?.ok !== true || result.milestonesVersion !== MILESTONE_VERSION ||
      result.action !== request.action || result.requestId !== request.requestId || !ID.test(result.id) ||
      (request.id && result.id !== request.id) || !isMilestoneTimestamp(result.updatedAt) ||
      result.deleted !== (request.action === "deleteMilestone")) {
    throw new Error("The server did not confirm the milestone write. Retry the same request to confirm it.");
  }
  return result;
}

export function validateMilestoneData(result) {
  if (result?.milestones?.version !== MILESTONE_VERSION) {
    throw new Error("Milestones is not supported by this backend yet. Deploy the reviewed backend update first.");
  }
  const { milestones, domains } = result;
  if (milestones.error) throw new Error(milestones.error);
  if (typeof milestones.configured !== "boolean" || !Array.isArray(milestones.items) ||
      !Array.isArray(domains) || domains.some(d => !d || typeof d.id !== "string" || !d.id ||
        d.id.length > 80 || /[,\s]/.test(d.id) || typeof d.name !== "string" || !d.name.trim()) ||
      new Set(domains.map(d => d.id)).size !== domains.length ||
      (!milestones.configured && milestones.items.length)) {
    throw new Error("Invalid Milestones response. No history has been assumed empty.");
  }
  const ids = new Set();
  for (const item of milestones.items) {
    const fields = validateMilestoneFields(item, domains);
    if (!ID.test(item.id) || ids.has(item.id.toLowerCase()) ||
        !isMilestoneTimestamp(item.createdAt) || !isMilestoneTimestamp(item.updatedAt) ||
        item.updatedAt < item.createdAt || JSON.stringify(fields) !== JSON.stringify({
          domainIds: item.domainIds, title: item.title, date: item.date, status: item.status,
          impact: item.impact, details: item.details, links: item.links,
        })) throw new Error("Invalid or duplicate milestone record. Ask the sheet owner to review its data.");
    ids.add(item.id.toLowerCase());
  }
  return result;
}
