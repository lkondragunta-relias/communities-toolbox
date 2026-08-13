import { ADMIN_TOKEN_STORAGE_KEY } from "../config/roadmapDefaults";

const URL_TOKEN_PARAM = "token";

function getAdminTokenCookie() {
  try {
    const prefix = `${encodeURIComponent(ADMIN_TOKEN_STORAGE_KEY)}=`;
    const entry = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix));
    return entry ? decodeURIComponent(entry.slice(prefix.length)).trim() : "";
  } catch {
    return "";
  }
}

function setAdminTokenCookie(token) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(ADMIN_TOKEN_STORAGE_KEY)}=${encodeURIComponent(token)}; Path=/; SameSite=Strict${secure}`;
}

function clearAdminTokenCookie() {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(ADMIN_TOKEN_STORAGE_KEY)}=; Path=/; Max-Age=0; SameSite=Strict${secure}`;
}

/** Read ?token= from the URL and persist it as the admin token. Returns the token if applied. */
export function applyAdminTokenFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get(URL_TOKEN_PARAM);
    if (!token) return "";
    const trimmed = String(token).trim();
    if (!trimmed) return "";
    setStoredAdminToken(trimmed);
    // Strip the token from the address bar so it doesn't linger in browser
    // history or get copied into shared links/screenshots.
    params.delete(URL_TOKEN_PARAM);
    const query = params.toString();
    const cleanUrl =
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState(null, "", cleanUrl);
    return trimmed;
  } catch {
    return "";
  }
}

export function getStoredAdminToken() {
  const cookieToken = getAdminTokenCookie();
  if (cookieToken) return cookieToken;

  try {
    const token = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    const trimmed = token ? String(token).trim() : "";
    if (trimmed) setStoredAdminToken(trimmed);
    return trimmed;
  } catch {
    return "";
  }
}

export function setStoredAdminToken(token) {
  const trimmed = String(token || "").trim();
  if (trimmed) {
    setAdminTokenCookie(trimmed);
  } else {
    clearAdminTokenCookie();
  }

  try {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Clear saved admin token (e.g. when user clicks Lock). */
export function clearStoredAdminTokens() {
  clearAdminTokenCookie();

  try {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
