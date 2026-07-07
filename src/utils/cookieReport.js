/**
 * Best-effort parser for Cookiebot cookie-scan reports (CSV or JSON export).
 * It is intentionally forgiving: any tabular export yields a useful summary,
 * and anything unparseable still stores the raw file for download.
 */

function detectDelimiter(headerLine) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of headerLine) if (ch in counts) counts[ch] += 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delim);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function parseJson(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.cookies)) return data.cookies;
  return [];
}

function pick(row, names) {
  for (const key of Object.keys(row)) {
    if (names.some((n) => key.includes(n))) return String(row[key] || "").trim();
  }
  return "";
}

const CATEGORY_NAMES = ["category", "categor", "consent", "type", "classification"];

/** Rough conversion of an expiry string to days. */
function expiryToDays(value) {
  const v = String(value || "").toLowerCase();
  if (!v) return null;
  if (/session/.test(v)) return 0;
  const num = parseFloat(v.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(num)) return null;
  if (/year/.test(v)) return num * 365;
  if (/month/.test(v)) return num * 30;
  if (/week/.test(v)) return num * 7;
  if (/hour/.test(v)) return num / 24;
  if (/day/.test(v) || num > 31) return num; // bare numbers usually days
  return num;
}

export function summarizeCookieReport(text, fileType, fileName) {
  let rows;
  try {
    if (/json/.test(fileType) || /\.json$/i.test(fileName || "")) {
      rows = parseJson(text);
    } else {
      rows = parseCsv(text);
    }
  } catch {
    rows = [];
  }

  if (!rows.length) {
    return { parsed: false, cookieCount: 0, categories: {}, issues: [], recommendations: [] };
  }

  const categories = {};
  let unclassified = 0;
  let marketing = 0;
  let longExpiry = 0;
  const providers = new Set();

  rows.forEach((row) => {
    const cat = pick(row, CATEGORY_NAMES) || "Unclassified";
    const catKey = cat || "Unclassified";
    categories[catKey] = (categories[catKey] || 0) + 1;
    if (/unclassified|unknown|^$/i.test(cat)) unclassified += 1;
    if (/market|advertis|target/i.test(cat)) marketing += 1;

    const provider = pick(row, ["provider", "domain", "host", "initiator"]);
    if (provider) providers.add(provider.toLowerCase());

    const days = expiryToDays(pick(row, ["expiry", "retention", "lifespan", "expires", "duration"]));
    if (days !== null && days > 365) longExpiry += 1;
  });

  const issues = [];
  const recommendations = [];

  if (unclassified > 0) {
    issues.push(`${unclassified} unclassified cookie${unclassified > 1 ? "s" : ""} found.`);
    recommendations.push("Classify unclassified cookies in Cookiebot so consent can be enforced correctly.");
  }
  if (marketing > 0) {
    recommendations.push(`Ensure prior consent is required before any of the ${marketing} marketing cookie(s) are set.`);
  }
  if (longExpiry > 0) {
    issues.push(`${longExpiry} cookie${longExpiry > 1 ? "s" : ""} retain data longer than 1 year.`);
    recommendations.push("Shorten retention on long-lived cookies to align with data-minimization best practice.");
  }
  if (providers.size > 8) {
    recommendations.push(`${providers.size} distinct providers detected — review third-party cookies you no longer need.`);
  }
  if (issues.length === 0) {
    issues.push("No major compliance issues detected in this report.");
  }

  return {
    parsed: true,
    cookieCount: rows.length,
    categories,
    unclassified,
    marketing,
    longExpiry,
    providerCount: providers.size,
    issues,
    recommendations,
  };
}
