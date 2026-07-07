import { ROADMAP_TITLE } from "../config/roadmapDefaults";
import ThemeSwitcher from "./ThemeSwitcher";

const ICONS = {
  overview: (
    <path d="M3 3h7v7H3V3zm11 0h7v4h-7V3zM3 14h7v7H3v-7zm11-3h7v10h-7V11z" />
  ),
  timeline: (
    <path d="M3 5h12v3H3V5zm4 5h13v3H7v-3zM3 15h9v3H3v-3z" />
  ),
  table: (
    <path d="M3 4h18v4H3V4zm0 6h18v4H3v-4zm0 6h18v4H3v-4z" />
  ),
  sites: (
    <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2c1.7 0 3.2 2.3 3.8 6H8.2C8.8 6.3 10.3 4 12 4zM4.3 9h3.4a22 22 0 000 6H4.3a8 8 0 010-6zm3.9 8h7.6c-.6 3-2 5-3.8 5s-3.2-2-3.8-5zm9.5-2a22 22 0 000-6h3.4a8 8 0 010 6h-3.4z" />
  ),
  settings: (
    <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm8.9 5.6.1-1.6-.1-1.6 1.7-1.3-1.7-3-2 .8a7 7 0 0 0-2.8-1.6L13.5 2h-3l-.3 2.3A7 7 0 0 0 7.4 6l-2-.8-1.7 3 1.7 1.3-.1 1.6.1 1.6-1.7 1.3 1.7 3 2-.8a7 7 0 0 0 2.8 1.6l.3 2.3h3l.3-2.3a7 7 0 0 0 2.8-1.6l2 .8 1.7-3-1.7-1.3z" />
  ),
};

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Roadmap" },
  // { id: "table", label: "Projects" }, // hidden for now
  { id: "sites", label: "Sites & Cookiebot" },
  { id: "settings", label: "Settings" },
];

function NavIcon({ name }) {
  return (
    <svg className="sidebar__icon" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export default function Sidebar({
  view,
  onNavigate,
  collapsed = false,
  themePreference,
  onThemeChange,
}) {
  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="sidebar__brand">
        <span className="sidebar__logo" aria-hidden="true">R</span>
        <span className="sidebar__brand-text">{ROADMAP_TITLE}</span>
      </div>

      <nav className="sidebar__nav" aria-label="Primary">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            title={collapsed ? item.label : undefined}
            className={`sidebar__link${view === item.id ? " is-active" : ""}`}
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => onNavigate(item.id)}
          >
            <NavIcon name={item.id} />
            <span className="sidebar__link-text">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        {onThemeChange ? (
          <div className="sidebar__theme">
            <ThemeSwitcher preference={themePreference} onChange={onThemeChange} />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
