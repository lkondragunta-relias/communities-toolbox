import { ROADMAP_TITLE } from "../config/roadmapDefaults";
import Icon from "./Icon";

const NAV = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "timeline", label: "Roadmap", icon: "roadmap" },
  // { id: "table", label: "Projects" }, // hidden for now
  { id: "incidents", label: "Operations", icon: "operations" },
  { id: "sites", label: "Cookiebot", icon: "cookiebot" },
  {
    id: "accessibility",
    label: "Accessibility",
    icon: "accessibility",
    href: "https://a11y-monitor-seven.vercel.app/dashboard",
  },
  { id: "settings", label: "Settings", icon: "settings" },
];

export default function Sidebar({ view, onNavigate, collapsed = false, onToggleCollapse }) {
  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">R</span>
        <span className="sidebar__brand-text">{ROADMAP_TITLE}</span>
      </div>

      <nav className="sidebar__nav" aria-label="Primary">
        {NAV.map((item) =>
          item.href ? (
            <a
              key={item.id}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              title={collapsed ? item.label : undefined}
              className="sidebar__link"
            >
              <Icon name={item.icon} className="sidebar__icon" />
              <span className="sidebar__link-text">{item.label}</span>
              <Icon name="external" className="sidebar__external" />
            </a>
          ) : (
            <button
              key={item.id}
              type="button"
              title={collapsed ? item.label : undefined}
              className={`sidebar__link${view === item.id ? " is-active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <Icon name={item.icon} className="sidebar__icon" />
              <span className="sidebar__link-text">{item.label}</span>
            </button>
          )
        )}
      </nav>

      {onToggleCollapse ? (
        <div className="sidebar__footer">
          <button
            type="button"
            className="sidebar__collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
          >
            <Icon name="panel" className="sidebar__icon" />
            <span className="sidebar__link-text">Collapse</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
