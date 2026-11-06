import { ROUTES } from "./navigation.js";

export const FEEDBACK_CATEGORIES = [
  "Report a bug",
  "Request a feature",
  "Share feedback",
  "Report a data correction",
];
export const FEEDBACK_LIMITS = { name: 100, message: 5000 };
export const FEEDBACK_SITE = "https://lkondragunta-relias.github.io/communities-toolbox/";

export function validateFeedback(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid feedback.");
  const allowed = ["action", "requestId", "name", "category", "page", "message"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("Unexpected feedback field.");
  if (input.action !== undefined && input.action !== "submitFeedback") throw new Error("Invalid feedback action.");
  const result = {};
  for (const field of ["name", "message"]) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new Error(field === "name" ? "Please enter your name." : "Please enter your message.");
    }
    const hasControl = [...input[field]].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    });
    if (input[field].length > FEEDBACK_LIMITS[field] || hasControl) {
      throw new Error(`Invalid ${field}. Maximum ${FEEDBACK_LIMITS[field]} characters.`);
    }
    result[field] = input[field].trim();
  }
  if (!FEEDBACK_CATEGORIES.includes(input.category)) throw new Error("Choose a feedback category.");
  if (!ROUTES.some((route) => route.id === input.page)) throw new Error("Choose an internal page.");
  if (typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) {
    throw new Error("Invalid feedback request ID.");
  }
  return { ...result, category: input.category, page: input.page, requestId: input.requestId.toLowerCase() };
}

export function feedbackPageUrl(page) {
  return `${FEEDBACK_SITE}#/${ROUTES.find((route) => route.id === page).path}`;
}

export function validateFeedbackReceipt(result, requestId) {
  if (result?.ok !== true || result.requestId !== requestId ||
      typeof result.id !== "string" || !/^FB-[0-9a-f-]{36}$/i.test(result.id) ||
      typeof result.submittedAt !== "string" || !Number.isFinite(Date.parse(result.submittedAt))) {
    throw new Error("The server did not confirm a saved submission. Retry to confirm it.");
  }
  return result;
}
