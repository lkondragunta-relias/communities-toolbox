/**
 * Parser for Cookiebot "Cookie scan report" .htm exports.
 *
 * Produces a clean summary + the per-cookie list, and in particular the cookies
 * flagged "Blocked until accepted by user: No" — i.e. set BEFORE consent, which
 * are the compliance risks the team needs to action.
 *
 * Runs in the browser on the uploaded file's text (no DOM needed).
 */

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Detect a Cookiebot report by its signature markup. */
export function isCookiebotHtml(text) {
  return /cybotreportbody|Cookie scan report|Blocked until accepted by user/i.test(text || "");
}

function parseSummary(html) {
  // The summary is a <br>-separated "Label: &nbsp;Value" block.
  const text = decodeEntities(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  );
  const grab = (label) => {
    const re = new RegExp(
      label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*([^\\n]+)",
      "i"
    );
    const m = text.match(re);
    return m ? m[1].replace(/\s+/g, " ").trim() : "";
  };
  return {
    scanDate: grab("Scan date"),
    domain: grab("Domain name"),
    serverLocation: grab("Server location"),
    total: grab("Cookies, in total"),
    newCookies: grab("New cookies"),
    removedCookies: grab("Removed cookies"),
    gcm: {
      riskSummary: grab("Risk Summary"),
      defaultParams: grab('GCM consent parameters set as "Default"'),
      cmpSignal: grab("CMP to GCM consent signal is active"),
      trackersBlocked: grab("Google trackers blocked prior consent"),
    },
  };
}

const CATEGORIES = ["Necessary", "Preferences", "Statistics", "Marketing", "Unclassified"];

function categoryMarkers(html) {
  const found = [];
  CATEGORIES.forEach((c) => {
    const m = html.match(new RegExp(">\\s*" + c + "\\s*\\((\\d+)\\)"));
    if (m) found.push({ pos: m.index, cat: c });
  });
  return found.sort((a, b) => a.pos - b.pos);
}

function fieldValue(block, label) {
  // Capture the value after "[<b>]Label: </b>" up to the next <br>, <b>, or close
  // tag. The <b> is optional because the block may start at the label text itself.
  const m = block.match(
    new RegExp(
      "(?:<b>\\s*)?" +
        label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\s*:?\\s*</b>([\\s\\S]*?)(?:<br|<b>|</(?:div|small|font|td))",
      "i"
    )
  );
  return m ? stripTags(m[1]) : "";
}

function parseModernCookies(html, headings) {
  const cookies = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const category = stripTags(heading[1]).replace(/^Category:\s*/i, "");
    // The New and Removed sections repeat cookie details but aren't part of the scan inventory.
    if (!CATEGORIES.includes(category)) continue;
    const section = html.slice(heading.index + heading[0].length, headings[i + 1]?.index);
    for (const [, row] of section.matchAll(/<tr\b[^>]*>((?:(?!<\/?tr\b)[\s\S])*?)<\/tr>/gi)) {
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
      const details = cells[0]?.[1] || "";
      const name = details.match(/<span\b[^>]*\bclass=["']cookie-name["'][^>]*>([\s\S]*?)<\/span>/i);
      if (!name) continue;

      cookies.push({
        category,
        name: stripTags(name[1]),
        provider: stripTags(cells[1]?.[1] || ""),
        type: stripTags(cells[2]?.[1] || ""),
        duration: stripTags(cells[3]?.[1] || ""),
        firstUrl: fieldValue(details, "First found URL"),
        initiator: fieldValue(details, "Initiator"),
        source: fieldValue(details, "Source"),
        blocked: fieldValue(details, "Blocked until accepted by user"),
      });
    }
  }
  return cookies;
}

function parseLegacyCookies(html) {
  const markers = categoryMarkers(html);
  const catAt = (pos) => {
    let cur = "Unclassified";
    for (const x of markers) if (x.pos <= pos) cur = x.cat;
    return cur;
  };

  // Each cookie block contains exactly one "First found URL" — anchor on it.
  const anchors = [];
  const re = /First found URL/g;
  let mm;
  while ((mm = re.exec(html))) anchors.push(mm.index);

  const cookies = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const detailRowStart = html.lastIndexOf("<tr", a);
    const headStart = html.lastIndexOf("<tr", detailRowStart - 1);
    const head = html.slice(headStart, detailRowStart);

    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(head))) {
      const t = stripTags(cm[1]);
      if (t) cells.push(t);
    }

    const end = i + 1 < anchors.length ? anchors[i + 1] : Math.min(html.length, a + 3000);
    const block = html.slice(a, end);
    const blockedM = block.match(
      /Blocked until accepted by user:\s*<\/b>\s*<font[^>]*>\s*(\w+)/i
    );

    cookies.push({
      category: catAt(a),
      name: cells[0] || "",
      provider: cells[1] || "",
      type: cells[2] || "",
      duration: cells[3] || "",
      firstUrl: fieldValue(block, "First found URL"),
      initiator: fieldValue(block, "Initiator"),
      source: fieldValue(block, "Source"),
      blocked: blockedM ? blockedM[1] : "",
    });
  }

  return cookies;
}

/** Full parse → { summary, cookies, notBlocked }. */
export function parseCookiebotHtml(html) {
  const summary = parseSummary(html);
  const headings = [...html.matchAll(/<span\b[^>]*\bclass=["']cat-name["'][^>]*>([\s\S]*?)<\/span>/gi)];
  const cookies = headings.length ? parseModernCookies(html, headings) : parseLegacyCookies(html);

  // Cookies set before consent (the compliance risks), de-duplicated.
  const seen = new Set();
  const notBlocked = [];
  cookies.forEach((c) => {
    if (c.blocked.toLowerCase() !== "no") return;
    const key = [c.name, c.provider, c.type, c.duration, c.initiator, c.source].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    notBlocked.push(c);
  });
  return { summary, cookies, notBlocked };
}

const CSV_COLUMNS = [
  ["category", "Classification"],
  ["name", "Cookie Name"],
  ["provider", "Provider"],
  ["type", "Type"],
  ["duration", "Max Storage Duration"],
  ["firstUrl", "First found URL"],
  ["initiator", "Initiator"],
  ["source", "Source"],
];

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from a list of parsed cookies (the not-blocked list). */
export function cookiesToCsv(cookies) {
  const header = ["Item No", ...CSV_COLUMNS.map(([, label]) => label)];
  const lines = [header.join(",")];
  cookies.forEach((c, i) => {
    const row = [i + 1, ...CSV_COLUMNS.map(([key]) => csvCell(c[key]))];
    lines.push(row.join(","));
  });
  return lines.join("\n");
}
