import { useCallback, useRef, useState } from "react";
import {
  addCookiebotSite,
  deleteCookiebotSite,
  addCookiebotReport,
  deleteCookiebotReport,
} from "../../services/sheetsApi";
import { isCookiebotHtml, parseCookiebotHtml, cookiesToCsv } from "../../utils/cookiebotHtml";

function formatBytes(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function GcmRow({ label, value }) {
  const v = value || "—";
  // Negative signals first, so e.g. "Inactive" / "Not active" never reads as ok.
  const bad = /inactive|not active|at risk|fail|missing|none/i.test(v);
  const ok = !bad && /no risk|active|yes|enabled|no\b/i.test(v);
  return (
    <li>
      <span>{label}</span>
      {value ? (
        <span className={`cb-status ${ok ? "cb-status--ok" : "cb-status--risk"}`}>{v}</span>
      ) : (
        <span>—</span>
      )}
    </li>
  );
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SitesView({ adminUnlocked, data, adminToken, refetch }) {
  const sites = data?.cookiebotSites || [];
  const allReports = data?.cookiebotReports || [];

  const [selectedName, setSelectedName] = useState(sites[0]?.name || null);
  const [selectedReportKey, setSelectedReportKey] = useState(null);
  const [newSite, setNewSite] = useState({ name: "", domain: "" });
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const selectedSite =
    sites.find((s) => s.name === selectedName) || sites[0] || null;

  const reports = allReports
    .filter((r) => selectedSite && r.site === selectedSite.name)
    .slice()
    .sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));

  const reportKey = (r) => `${r.fileName}__${r.uploaded}`;
  // The report shown in the summary card: the clicked one, else the latest.
  const latest =
    reports.find((r) => reportKey(r) === selectedReportKey) || reports[0];

  const handleAddSite = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");
      try {
        await addCookiebotSite({ adminToken, name: newSite.name, domain: newSite.domain });
        setSelectedName(newSite.name.trim());
        setNewSite({ name: "", domain: "" });
        refetch();
      } catch (err) {
        setError(err.message || "Could not add site.");
      }
    },
    [adminToken, newSite, refetch]
  );

  const handleDeleteSite = useCallback(
    async (name) => {
      if (!window.confirm(`Delete site "${name}" and its reports?`)) return;
      try {
        await deleteCookiebotSite({ adminToken, name });
        refetch();
      } catch (err) {
        setError(err.message || "Could not delete site.");
      }
    },
    [adminToken, refetch]
  );

  const handleUpload = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file || !selectedSite) return;
      setUploading(true);
      setError("");
      try {
        const text = await file.text();
        if (!isCookiebotHtml(text)) {
          throw new Error("Not a Cookiebot .htm scan report.");
        }
        const parsed = parseCookiebotHtml(text);
        const reportData = {
          domain: parsed.summary.domain,
          scanDate: parsed.summary.scanDate,
          serverLocation: parsed.summary.serverLocation,
          total: parsed.summary.total,
          newCookies: parsed.summary.newCookies,
          removedCookies: parsed.summary.removedCookies,
          notBlockedCount: parsed.notBlocked.length,
          gcm: parsed.summary.gcm,
          notBlocked: parsed.notBlocked,
        };
        await addCookiebotReport({
          adminToken,
          site: selectedSite.name,
          fileName: file.name,
          uploaded: new Date().toISOString(),
          size: formatBytes(file.size),
          data: reportData,
        });
        refetch();
      } catch (err) {
        setError(err.message || "Upload failed.");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [adminToken, selectedSite, refetch]
  );

  const handleExportCsv = useCallback((report) => {
    const list = report?.data?.notBlocked || [];
    const base = (report?.site || "site").replace(/[^a-z0-9]+/gi, "-");
    downloadCsv(`${base}-not-blocked-cookies.csv`, cookiesToCsv(list));
  }, []);

  const handleDeleteReport = useCallback(
    async (report) => {
      if (!window.confirm(`Delete report "${report.fileName}"?`)) return;
      try {
        await deleteCookiebotReport({
          adminToken,
          site: report.site,
          fileName: report.fileName,
          uploaded: report.uploaded,
        });
        refetch();
      } catch (err) {
        setError(err.message || "Could not delete report.");
      }
    },
    [adminToken, refetch]
  );

  const s = latest?.data;

  return (
    <div className="sites">
      <aside className="sites__list">
        <h3 className="sites__list-title">Sites</h3>
        <ul>
          {sites.map((site) => (
            <li key={site.name}>
              <button
                type="button"
                className={`sites__site${site.name === selectedSite?.name ? " is-active" : ""}`}
                onClick={() => {
                  setSelectedName(site.name);
                  setSelectedReportKey(null); // each site defaults to its latest report
                }}
              >
                <span className="sites__site-name">{site.name}</span>
                {site.domain ? <span className="sites__site-url">{site.domain}</span> : null}
              </button>
            </li>
          ))}
          {sites.length === 0 ? <li className="sites__empty">No sites yet.</li> : null}
        </ul>

        {adminUnlocked ? (
          <form className="sites__add" onSubmit={handleAddSite}>
            <input
              type="text"
              placeholder="Site name"
              value={newSite.name}
              onChange={(e) => setNewSite((v) => ({ ...v, name: e.target.value }))}
              required
            />
            <input
              type="text"
              placeholder="Domain (e.g. www.relias.com)"
              value={newSite.domain}
              onChange={(e) => setNewSite((v) => ({ ...v, domain: e.target.value }))}
            />
            <button type="submit" className="sites__add-btn">
              Add site
            </button>
          </form>
        ) : null}
      </aside>

      <section className="sites__detail">
        {!selectedSite ? (
          <p className="panel__empty">Add a site to start tracking its Cookiebot reports.</p>
        ) : (
          <>
            <header className="sites__detail-head">
              <div>
                <h2 className="sites__detail-title">{selectedSite.name}</h2>
                {selectedSite.domain ? (
                  <span className="sites__detail-url">{selectedSite.domain}</span>
                ) : null}
              </div>
              <div className="sites__detail-actions">
                {adminUnlocked ? (
                  <>
                    <label className="sites__upload">
                      {uploading ? "Uploading…" : "Upload .htm report"}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".htm,.html,text/html"
                        onChange={handleUpload}
                        hidden
                        disabled={uploading}
                      />
                    </label>
                    <button
                      type="button"
                      className="sites__danger"
                      onClick={() => handleDeleteSite(selectedSite.name)}
                    >
                      Delete site
                    </button>
                  </>
                ) : null}
              </div>
            </header>

            {error ? <p className="roadmap__error">{error}</p> : null}

            {s ? (
              <div className="report-summary">
                <div className="cb-summary-head">
                  <h3 className="panel__title">
                    {s.domain}
                    {latest?.fileName ? (
                      <span className="cb-report-file"> · {latest.fileName}</span>
                    ) : null}
                  </h3>
                  <span className="cb-scan-date">Scan date: {s.scanDate}</span>
                </div>
                <div className="report-summary__stats">
                  <div><strong>{s.total}</strong><span>cookies</span></div>
                  <div><strong>{s.newCookies}</strong><span>new</span></div>
                  <div><strong>{s.removedCookies}</strong><span>removed</span></div>
                  <div className={s.notBlockedCount > 0 ? "cb-risk" : ""}>
                    <strong>{s.notBlockedCount}</strong><span>not blocked</span>
                  </div>
                  <div><strong>{s.serverLocation || "—"}</strong><span>server</span></div>
                </div>

                <div className="cb-gcm">
                  <h4>Google Consent Mode</h4>
                  <ul>
                    <GcmRow label="Risk summary" value={s.gcm?.riskSummary} />
                    <GcmRow label="Default params" value={s.gcm?.defaultParams} />
                    <GcmRow label="CMP→GCM signal" value={s.gcm?.cmpSignal} />
                    <GcmRow label="Trackers blocked" value={s.gcm?.trackersBlocked} />
                  </ul>
                </div>

                <div className="cb-notblocked-head">
                  <h4>
                    Cookies set before consent — “Blocked: No”
                    <span className="cb-count" data-zero={s.notBlockedCount === 0}>
                      {s.notBlockedCount}
                    </span>
                  </h4>
                  {s.notBlockedCount > 0 ? (
                    <button
                      type="button"
                      className="projects-table__btn"
                      onClick={() => handleExportCsv(latest)}
                    >
                      Export CSV
                    </button>
                  ) : null}
                </div>

                {s.notBlockedCount === 0 ? (
                  <p className="panel__empty">No cookies were set before consent. 🎉</p>
                ) : (
                  <div className="cb-table-wrap">
                    <table className="projects-table">
                      <thead>
                        <tr>
                          <th>Classification</th>
                          <th>Cookie Name</th>
                          <th>Provider</th>
                          <th>Type</th>
                          <th>Max Storage Duration</th>
                          <th>First found URL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(s.notBlocked || []).map((c, idx) => (
                          <tr key={`${c.name}-${idx}`}>
                            <td>{c.category}</td>
                            <td className="projects-table__name">{c.name}</td>
                            <td>{c.provider}</td>
                            <td>{c.type}</td>
                            <td className="projects-table__timeline">{c.duration}</td>
                            <td>
                              {c.firstUrl ? (
                                <a href={c.firstUrl} target="_blank" rel="noopener noreferrer">
                                  link ↗
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}

            <h3 className="panel__title">Reports</h3>
            {reports.length === 0 ? (
              <p className="panel__empty">No reports uploaded yet.</p>
            ) : (
              <table className="projects-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Uploaded</th>
                    <th>Size</th>
                    <th>Cookies</th>
                    <th>Not blocked</th>
                    <th className="projects-table__actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r, idx) => (
                    <tr
                      key={`${r.fileName}-${idx}`}
                      className={reportKey(r) === reportKey(latest) ? "is-active-report" : ""}
                    >
                      <td className="projects-table__name">
                        <button
                          type="button"
                          className="projects-table__namebtn"
                          onClick={() => setSelectedReportKey(reportKey(r))}
                          title="Show this report above"
                        >
                          {r.fileName}
                        </button>
                      </td>
                      <td className="projects-table__timeline">{formatDate(r.uploaded)}</td>
                      <td>{r.size || "—"}</td>
                      <td>{r.data?.total ?? "—"}</td>
                      <td>{r.data?.notBlockedCount ?? "—"}</td>
                      <td className="projects-table__actions">
                        <button
                          type="button"
                          className="projects-table__btn"
                          onClick={() => handleExportCsv(r)}
                        >
                          CSV
                        </button>
                        {adminUnlocked ? (
                          <button
                            type="button"
                            className="projects-table__btn projects-table__btn--danger"
                            onClick={() => handleDeleteReport(r)}
                          >
                            Delete
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}
