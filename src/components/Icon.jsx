/**
 * The toolbox icon set.
 *
 * One stroke-based family for the whole app — 24×24 grid, 1.75 stroke, round
 * caps and joins, no fills. Previously the sidebar and the Operations view each
 * carried their own hand-written filled paths, which is why they never looked
 * like they came from the same product.
 *
 * Geometry is built from primitives (rect / line / circle / polyline) rather
 * than long path strings, so the shapes stay on the grid and stay legible at
 * 15–18px.
 */

const S = {
  /* --- navigation --- */
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  roadmap: (
    <>
      <rect x="3" y="4.5" width="11" height="4" rx="2" />
      <rect x="7" y="10" width="13" height="4" rx="2" />
      <rect x="3" y="15.5" width="8" height="4" rx="2" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9.5" y1="9.5" x2="9.5" y2="20" />
    </>
  ),
  operations: (
    <polyline points="3 12 7.5 12 10 5.5 14 18.5 16.5 12 21 12" />
  ),
  cookiebot: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </>
  ),
  accessibility: (
    <>
      <circle cx="12" cy="4.5" r="1.8" />
      <line x1="4.5" y1="9" x2="19.5" y2="9" />
      <path d="M9 21l3-7 3 7" />
      <line x1="12" y1="9" x2="12" y2="14" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2.2" />
      <circle cx="15" cy="12" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
    </>
  ),

  /* --- controls --- */
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </>
  ),
  layers: (
    <>
      <polygon points="12 3 21 8 12 13 3 8 12 3" />
      <polyline points="3 13 12 18 21 13" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
      <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
    </>
  ),
  download: (
    <>
      <line x1="12" y1="3" x2="12" y2="14.5" />
      <polyline points="7.5 10 12 14.5 16.5 10" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <line x1="20" y1="4" x2="11.5" y2="12.5" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
};

export default function Icon({ name, className = "", size = 16 }) {
  const glyph = S[name];
  if (!glyph) return null;
  return (
    <svg
      // The base class always applies, and width/height attributes act as a
      // floor: a caller passing only a modifier class can never end up with an
      // unsized (and therefore huge) SVG.
      className={`icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}
