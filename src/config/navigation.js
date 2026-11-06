export const ROUTES = [
  { id: "overview", path: "overview", title: "Overview", label: "Overview", icon: "overview" },
  { id: "timeline", path: "roadmap", title: "Roadmap", label: "Roadmap", icon: "roadmap" },
  { id: "table", path: "projects", title: "Projects", label: "Projects", icon: "table", hidden: true },
  { id: "incidents", path: "operations", title: "Communities Operations Timeline", label: "Operations", icon: "operations" },
  { id: "sites", path: "cookiebot", title: "Cookiebot", label: "Cookiebot", icon: "cookiebot" },
  { id: "org", path: "prod-eng-org", title: "Communities Eng & Product Organization", label: "Prod & Eng Org", icon: "organization" },
  { id: "settings", path: "settings", title: "Settings", label: "Settings", icon: "settings" },
];

export const NAVIGATION = [
  ...ROUTES.filter((route) => !route.hidden && route.id !== "settings"),
  { id: "accessibility", label: "Accessibility", icon: "accessibility", href: "https://a11y-monitor-seven.vercel.app/dashboard" },
  ROUTES.find((route) => route.id === "settings"),
];
