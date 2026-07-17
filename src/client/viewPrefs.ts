// Sticky outline/table view-mode preference for the shared action list views
// (PROG-126). Each surface (container pages, the Agenda) remembers its own
// last-used mode, so the Agenda can live as a table while arc pages stay
// outlines. Same fail-soft localStorage pattern as outlinePrefs (PROG-77):
// storage trouble just means "default this time".

export type ActionViewMode = "outline" | "table";

const key = (surface: string) => `progress:action-view:${surface}`;

export function loadViewMode(surface: string, fallback: ActionViewMode): ActionViewMode {
  try {
    const raw = window.localStorage.getItem(key(surface));
    if (raw === "outline" || raw === "table") return raw;
  } catch {
    /* default this time */
  }
  return fallback;
}

export function saveViewMode(surface: string, mode: ActionViewMode): void {
  try {
    window.localStorage.setItem(key(surface), mode);
  } catch {
    /* sticky preference is a nicety — ignore storage failures */
  }
}
