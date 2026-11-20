import { useEffect, useState } from "react";
import { comparisonChange, metrics } from "../../utils/analytics.js";
import "../../styles/analytics.css";

const enabled = import.meta.env.VITE_PRIVATE_ANALYTICS === "true";
const googleDashboard = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(import.meta.env.VITE_GOOGLE_ANALYTICS_DASHBOARD_URL)
  ? import.meta.env.VITE_GOOGLE_ANALYTICS_DASHBOARD_URL : null;
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const shortDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const windowDate = date => new Date(`${date}T00:00:00Z`);
const rangeLabel = window => {
  const start = windowDate(window.startDate);
  const end = windowDate(window.endDate);
  return window.startDate === window.endDate ? dateFormat.format(start) : dateFormat.formatRange(start, end);
};

function dateSummary(labels, unavailable) {
  const dates = new Set(labels);
  if (dates.size > 1) return "Dates vary by domain. See the table.";
  return dates.values().next().value ?? unavailable;
}

function formatMetric(key, value, currency) {
  if (!Number.isFinite(value)) return "—";
  if (key === "purchaseRevenue" || key === "averagePurchaseRevenue") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  }
  if (key === "sessionKeyEventRate") return `${(value * 100).toFixed(2)}%`;
  return value.toLocaleString("en-US");
}

async function loadFromToolbox(signal) {
  const response = await fetch(`${import.meta.env.BASE_URL}api/analytics`, {
    credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", signal,
  });
  if (response.status === 401 || response.status === 403) return { denied: true };
  if (!response.ok) throw new Error("Snapshot unavailable");
  return { snapshot: await response.json() };
}

export default function AnalyticsView({ loadSnapshot = googleDashboard ? null : enabled ? loadFromToolbox : null }) {
  const [period, setPeriod] = useState("day");
  const [comparison, setComparison] = useState("prior");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("purchaseRevenue");
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!loadSnapshot) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    async function read() {
      try {
        const { denied, snapshot: result } = await loadSnapshot(signal);
        if (denied) {
          if (!controller.signal.aborted) setError("Sign in with an account that has access to Toolbox analytics.");
          return;
        }
        if (result?.version !== 1 || !Array.isArray(result.domains)) throw new Error("Invalid snapshot");
        if (!controller.signal.aborted) setSnapshot(result);
      } catch {
        if (!controller.signal.aborted) setError("Could not load analytics right now.");
      }
    }
    void read();
    return () => controller.abort();
  }, [attempt, loadSnapshot]);

  if (!loadSnapshot) return googleDashboard
    ? <div className="analytics__panel"><p>Sign in with your Relias Google account to view the dashboard.</p>
      <a href={googleDashboard} target="_blank" rel="noopener noreferrer">Open private Analytics</a></div>
    : <p className="analytics__panel">Live analytics are available only on a private Toolbox deployment.</p>;
  if (error) return <div className="analytics__panel"><p role="alert">{error}</p><button type="button" className="app__ghost-btn" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</button></div>;
  if (!snapshot) return <p role="status">Loading analytics…</p>;

  const comparisonKey = `${comparison}_${period}`;
  const currentDates = [];
  const comparisonDates = [];
  for (const row of snapshot.domains) {
    const current = row.windows?.[period];
    if (!current) continue;
    currentDates.push(period === "day" ? shortDateFormat.format(windowDate(current.startDate)) : rangeLabel(current));
    const baseline = comparison !== "off" && row.status !== "Stale" ? row.windows?.[comparisonKey] : null;
    if (baseline) comparisonDates.push(`${rangeLabel(current)} vs. ${rangeLabel(baseline)}`);
  }

  const domains = snapshot.domains.filter(row => `${row.name} ${row.host ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (sortKey === "name") return byName;
      const value = row => row.status !== "Stale" ? row.windows?.[period]?.metrics[sortKey] ?? -Infinity : -Infinity;
      const aValue = value(a);
      const bValue = value(b);
      if (sortKey === "purchaseRevenue") {
        const byAvailability = Number(!Number.isFinite(aValue)) - Number(!Number.isFinite(bValue));
        if (byAvailability) return byAvailability;
      }
      if (!a.currency || !b.currency) return Number(!a.currency) - Number(!b.currency) || byName;
      if (sortKey === "purchaseRevenue" && a.currency !== b.currency) return a.currency.localeCompare(b.currency);
      if (aValue !== bValue) return aValue > bValue ? -1 : 1;
      return byName;
    });

  return (
    <section className="analytics" aria-label="Domain analytics">
      <div className="analytics__panel analytics__controls">
        <div>
          <div className="layout-switch" role="group" aria-label="Date range">
            {[["day", "Yesterday"], ["week", "Last 7 days"]].map(([key, label]) => (
              <button key={key} type="button" className={`layout-switch__btn${period === key ? " is-active" : ""}`}
                aria-pressed={period === key} onClick={() => setPeriod(key)}>{label}</button>
            ))}
          </div>
          <p aria-live="polite" className="analytics__date-label" data-testid="analytics-current-dates">
            {dateSummary(currentDates, "Reporting dates unavailable")}
          </p>
          <p>GA4 may revise recent figures. Dates use each property’s reporting time zone.</p>
        </div>
        <div>
          <label>Compare to <select value={comparison} onChange={event => setComparison(event.target.value)}>
            <option value="prior">Previous period</option>
            <option value="yoy">Same period last year</option>
            <option value="off">No comparison</option>
          </select></label>
          <p aria-live="polite" className="analytics__date-label" data-testid="analytics-comparison-dates">
            {comparison !== "off" ? dateSummary(comparisonDates, "Comparison dates unavailable") : null}
          </p>
        </div>
      </div>
      <div className="analytics__panel">
        <div className="analytics__controls">
          <div><h2 id="analytics-table-title">Performance by domain</h2><p role="status">{domains.length} of {snapshot.domains.length} domains</p></div>
          <div className="analytics__filters">
            <input type="search" aria-label="Find a domain" placeholder="Find a domain" value={search} onChange={event => setSearch(event.target.value)} />
            <select aria-label="Sort domains" value={sortKey} onChange={event => setSortKey(event.target.value)}>
              <option value="sessions">Sort: Sessions</option><option value="purchaseRevenue">Sort: Revenue</option>
              <option value="ecommercePurchases">Sort: Purchases</option><option value="sessionKeyEventRate">Sort: Conversion rate</option>
              <option value="name">Sort: Domain A–Z</option>
            </select>
          </div>
        </div>
        <div className="analytics__scroll" role="region" aria-label="Domain metrics, scroll sideways for all columns" tabIndex={0}>
          <table aria-labelledby="analytics-table-title">
            <thead><tr><th scope="col">Domain</th>{metrics.map(([key, name]) => <th key={key} scope="col">{name}</th>)}<th scope="col">Data status</th></tr></thead>
            <tbody>{domains.map(row => {
              const current = row.windows?.[period];
              const baseline = row.status !== "Stale" && comparison !== "off" ? row.windows?.[comparisonKey] : null;
              const link = /^https:\/\/analytics\.google\.com\/analytics\/web\/#\/a\d+p\d+\/reports\/intelligenthome$/.test(row.url) ? row.url : null;
              return <tr key={row.id}>
                <th scope="row">{link ? <a href={link} target="_blank" rel="noopener noreferrer">{row.name} ↗</a> : row.name}
                  {row.host ? <small>{row.host}</small> : null}
                  {current ? <small>{rangeLabel(current)}{baseline ? ` vs. ${rangeLabel(baseline)}` : ""} · {row.timeZone}</small> : null}
                </th>
                {metrics.map(([key]) => {
                  const value = current?.metrics[key];
                  const delta = comparisonChange(key, value, baseline?.metrics[key]);
                  const digits = key === "sessionKeyEventRate" ? 2 : 1;
                  const rounded = delta === null ? null : Number(delta.toFixed(digits));
                  return <td key={key}><strong>{formatMetric(key, value, row.currency)}</strong>
                    {rounded !== null ? <small className={rounded > 0 ? "analytics__up" : rounded < 0 ? "analytics__down" : ""}>
                      {rounded > 0 ? "+" : ""}{rounded.toFixed(digits)}{digits === 2 ? " pp" : "%"}
                    </small> : null}
                  </td>;
                })}
                <td><span className="analytics__status" data-status={row.status}>{row.status}</span>
                  {row.reason ? <small>{row.reason}</small> : null}
                  {row.fetchedAt ? <small>Fetched {new Date(row.fetchedAt).toLocaleString("en-US", { timeZone: row.timeZone, dateStyle: "medium", timeStyle: "short" })}</small> : null}
                  {comparison !== "off" && current && !baseline && row.status !== "Stale" ? <small>Comparison unavailable</small> : null}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {!domains.length ? <p className="analytics__footer">{snapshot.domains.length ? "No domains match your search." : "No domains are configured."}</p> : null}
        <p className="analytics__footer">Scroll sideways on small screens. “—” means unavailable, not zero. Currency values are shown in each property’s reporting currency.</p>
      </div>
      <details className="analytics__panel analytics__definitions"><summary>Metric definitions</summary>
        <p>Conversion rate is the share of sessions with any configured GA4 key event, not purchases divided by sessions. Average order value is GA4’s Average purchase revenue. Purchases counts GA4 ecommerce purchase events.</p>
        <p>Previous period means the same weekday last week or the preceding seven days. Same period last year shifts the dates back exactly 52 weeks to match weekdays. Conversion changes use percentage points. Users can overlap between properties.</p>
      </details>
    </section>
  );
}
