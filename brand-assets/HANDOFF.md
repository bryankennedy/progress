# Progress — design system handoff

Drop the contents of this `brand-assets/` folder into your app and wire it up. Everything here is production-final — don't recreate the icon or re-pick colors, just reference these files.

## Files
- `progress-icon.svg` — the master mark (scalable; use anywhere you can use SVG)
- `favicon-16.png`, `favicon-32.png` — browser tab favicons
- `apple-touch-icon-180.png` — iOS home-screen icon
- `icon-512.png` — PWA / Android, standard
- `icon-512-maskable.png` — PWA maskable (has safe-zone padding so OS masks don't clip)
- `tokens.css` — all color, type, and radius tokens as CSS custom properties

## `<head>` snippet
```html
<link rel="icon" type="image/svg+xml" href="/brand-assets/progress-icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/brand-assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/brand-assets/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/brand-assets/apple-touch-icon-180.png">
<link rel="stylesheet" href="/brand-assets/tokens.css">
```

## `manifest.webmanifest`
```json
{
  "name": "Progress",
  "short_name": "Progress",
  "background_color": "#f0e9d9",
  "theme_color": "#f5efe0",
  "icons": [
    { "src": "/brand-assets/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/brand-assets/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

---

## Prompt for Claude Code

> I'm applying a finished design system called **"Progress — Adobe & Moss"** to my to-do app. The assets are in `brand-assets/` (an SVG mark, favicon/app-icon PNGs at 16/32/180/512 + a maskable 512, and `tokens.css`). **Use these files as-is — do not redraw the icon or invent new colors.**
>
> Please:
> 1. Import `brand-assets/tokens.css` globally and refactor existing hard-coded colors, fonts, and radii to the CSS variables it defines (`--paper`, `--canvas`, `--card`, `--ink`, `--adobe`, `--moss`, etc.). [If I use Tailwind: mirror these tokens into `tailwind.config` `theme.extend.colors`/`fontFamily` instead, keeping the same names.]
> 2. Add the favicon + apple-touch-icon + stylesheet `<head>` tags and the web manifest shown in `brand-assets/HANDOFF.md`.
> 3. Load the two fonts (Spectral for headings/body, IBM Plex Mono for labels/meta/code) via the Google Fonts link in `tokens.css`.
> 4. Apply the semantic color roles consistently:
>    - **Salmon Adobe** (`--adobe`) = primary actions, the active/"now" state, primary buttons.
>    - **Olive Moss** (`--moss`) = completed/done states, checkmarks, "grounded" accents.
>    - `--ink` on `--paper`/`--card` for text; `--ink-soft` for secondary; `--ink-faint` + mono for meta labels.
>    - The "generate prompt" affordance uses `--prompt-text`/`--prompt-border`/`--prompt-bg`.
> 5. Use `--paper` as the main surface, `--canvas` as the app background behind it, `--card` for raised rows/cards, `--line` for hairline dividers, and the `--r-*` radii.
>
> Keep the look muted, papery, and high-contrast (deep ink on light paper). After wiring it up, show me the home/today screen so I can confirm the palette reads correctly.
