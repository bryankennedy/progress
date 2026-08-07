// Theme presets (PROG-150): user-selectable color schemes. Mechanism is pure
// CSS — Tailwind's `@theme` block emits `:root` custom properties and every
// utility compiles to `var(--color-*)`, so a theme is just an override block
// keyed off `:root[data-theme="…"]` (see styles.css and brand-assets/tokens.css).
// `porcelain` IS the `@theme` default, so it needs no override block and no
// attribute — `data-theme` absent or `"porcelain"` both render porcelain.
//
// Persistence follows the viewPrefs.ts/outlinePrefs.ts idiom: one localStorage
// key, fail-soft (a storage throw just means "default this time", never a
// broken UI), single-user app so one global key suffices.
//
// No-flash boot: an inline <script> in index.html's <head> duplicates the
// theme-id/paper-color pairs below and applies them before first paint (it
// runs before any module script, so it can't import this file — see that
// script's comment). Keep the two in sync if a theme is added, removed, or
// recolored.

export type ThemeId = "porcelain" | "adobe" | "sanzo" | "mono";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  // Picker swatch: three reference colors from the theme's own palette
  // (paper surface, accent, moss) — NOT the app's live tokens, so these are
  // deliberately literal per-theme values, not var(--color-*) reads.
  swatch: { paper: string; accent: string; moss: string };
}

export const THEMES: ThemeMeta[] = [
  {
    id: "porcelain",
    label: "Porcelain",
    description: "ink & ultramarine on porcelain",
    swatch: { paper: "#f7f7f2", accent: "#3d52c4", moss: "#6c7a42" },
  },
  {
    id: "adobe",
    label: "Adobe",
    description: "the original warm earth tones",
    swatch: { paper: "#f5efe0", accent: "#8f5340", moss: "#707c46" },
  },
  {
    id: "sanzo",
    label: "Sanzo",
    description: "Wada Sanzo classic 342 — rose, cream & slate olive",
    swatch: { paper: "#f9f4e9", accent: "#b04249", moss: "#4e8042" },
  },
  {
    id: "mono",
    label: "Mono",
    description: "shades of black & white",
    swatch: { paper: "#f7f7f7", accent: "#111111", moss: "#767676" },
  },
];

const THEME_KEY = "progress:theme";
const THEME_IDS = new Set<ThemeId>(THEMES.map((t) => t.id));
const isThemeId = (v: string): v is ThemeId => THEME_IDS.has(v as ThemeId);

export function getTheme(): ThemeId {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw && isThemeId(raw)) return raw;
  } catch {
    /* default this time */
  }
  return "porcelain";
}

// Flips the live `data-theme` attribute and retints the PWA `theme-color`
// meta. DOM failures (no `document`, e.g. under a non-DOM test runner) are
// swallowed — the persisted preference is still the useful side effect.
function applyTheme(id: ThemeId): void {
  try {
    if (id === "porcelain") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = id;
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const theme = THEMES.find((t) => t.id === id);
    if (themeColorMeta && theme) themeColorMeta.setAttribute("content", theme.swatch.paper);
  } catch {
    /* no document (e.g. a non-DOM test runner) — the stored preference still applies next boot */
  }
}

// Sets the stored preference and applies it live — instant, no reload.
// Storage failures are swallowed (the switch still applies for this session).
export function setTheme(id: ThemeId): void {
  try {
    if (id === "porcelain") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, id);
  } catch {
    /* sticky preference is a nicety — ignore storage failures */
  }
  applyTheme(id);
}

// Re-applies the stored theme at app mount (PROG-163). The pre-paint
// /theme-boot.js is the primary application; this is the second line of
// defense so a blocked or failed boot script self-corrects once the app
// hydrates (worst case: one porcelain flash, never a stuck-wrong theme).
export function applyStoredTheme(): void {
  applyTheme(getTheme());
}
