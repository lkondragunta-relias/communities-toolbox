import { useEffect } from "react";

/**
 * The toolbox ships light-only.
 *
 * There used to be a System / Light / Dark switcher; only light was ever
 * properly designed, so the control was removed rather than left offering two
 * broken choices. The dark token block stays in the stylesheet — it costs
 * nothing and keeps the door open — but nothing selects it at runtime.
 */
export const THEME = "light";

export function useTheme() {
  useEffect(() => {
    document.documentElement.dataset.theme = THEME;
  }, []);
  return { resolved: THEME };
}
