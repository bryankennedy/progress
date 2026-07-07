### prettier-adoption — Prettier at printWidth 100, Markdown excluded

**Date:** 2026-07-07 · **Status:** adopted

**Problem.** The repo had no formatter config at all. The code was hand-written
in a wide style (~100–110 cols), so Zed's default bundled-Prettier-at-80-cols
reformatted on save and buried real changes under whitespace-only diffs. Editor,
agent, and CI each had their own idea of style.

**Decision.** Prettier (core, no plugins) is the single style authority:

- **`.prettierrc` at the repo root, nothing nested.** `printWidth: 100`; every
  other setting is a Prettier default stated explicitly (double quotes,
  semicolons, `trailingComma: "all"`, `arrowParens: "always"`, 2-space indent)
  because that is what the codebase already did — measured before choosing, the
  defaults matched everywhere except width. Width 100 vs 110 churn was nearly
  identical (~960 lines either way: 100 wraps long lines, 110 re-joins
  hand-wrapped ones), so the conventional 100 won.
- **Enforcement:** `bun run format` / `bun run format:check` (package.json),
  a `format:check` step first in the CI `test` job, and a committed
  `.zed/settings.json` so Zed format-on-save produces CI-identical output.
- **One-time reformat is its own isolated `chore:` commit** so it never
  tangles with feature diffs.

**Deliberate exclusions** (`.prettierignore`):

- **All Markdown.** Prettier pipe-pads tables, so editing one cell re-pads the
  whole table — recreating the whitespace-diff problem this decision exists to
  kill (REFERENCE/README tables would become 300+-char rows). It also rewrites
  `*italic*` → `_italic_` across ~46 hand-written docs. Docs stay hand-formatted;
  Zed's Markdown format-on-save is off in `.zed/settings.json`.
- **`drizzle/` + `bun.lock`** — machine-generated; formatting them creates
  drift against their generators.

**Considered and rejected:** Biome (fast single tool, but Zed's first-class
path is Prettier and matching the existing style mattered more than lint
speed); import-sort plugins and an ESLint layer (imports are already
consistently grouped packages → shared → relative, so a sorter adds churn and
an editor/CI-divergence risk for near-zero gain — revisit if import order
actually drifts).
