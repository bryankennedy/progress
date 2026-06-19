// One-shot retheme: map the old stone/sky/red/emerald palette utilities to the
// "Adobe & Moss" brand tokens (defined in src/client/styles.css @theme).
// Ordered most-specific → most-generic so context-sensitive cases (primary
// buttons, the drop target, danger states) win before the catch-all neutrals.
// Run once with `bun scripts/retheme.mjs`; idempotent enough but intended as a
// single migration pass.

import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync("src/client/**/*.tsx");

// [from, to] applied in order via global literal replace.
const LITERALS = [
  // ── Primary buttons: black → Salmon Adobe (primary action) ──
  [
    "bg-stone-900 px-3 py-1 text-sm text-white hover:bg-stone-700",
    "bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep",
  ],
  [
    "bg-stone-900 px-2 py-1 text-xs text-white hover:bg-stone-700",
    "bg-adobe px-2 py-1 text-xs text-white hover:bg-adobe-deep",
  ],
  // Hint glyphs that sit *inside* those now-Adobe buttons.
  ['New <span className="text-stone-400">▾</span>', 'New <span className="text-white/70">▾</span>'],
  [
    'New issue <span className="text-stone-400">(C)</span>',
    'New issue <span className="text-white/70">(C)</span>',
  ],

  // ── Overlays / scrims ──
  ["bg-stone-900/20", "bg-ink/20"],

  // ── Active "now" accents → Adobe ──
  ["bg-sky-50 ring-1 ring-sky-200", "bg-adobe-wash/30 ring-1 ring-adobe-light"],

  // ── Done/grounded hover → Moss ──
  ["hover:border-emerald-400 hover:text-emerald-700", "hover:border-moss hover:text-moss-deep"],

  // ── App shell wrapper ──
  ["bg-stone-50 text-stone-900", "bg-canvas text-ink"],

  // ── Links / interactive accent → Adobe ──
  ["text-sky-600", "text-adobe"],
  ["text-sky-700", "text-adobe-deep"],

  // ── Danger / overdue ──
  ["text-red-600", "text-danger"],
  ["text-red-700", "text-danger"],
  ["bg-red-50/50", "bg-danger-bg/50"],
  ["bg-red-50", "bg-danger-bg"],
  ["border-red-200", "border-danger-border"],

  // ── Neutrals (specific opacity variants before bare) ──
  ["bg-stone-50/90", "bg-paper/90"],
  ["bg-stone-50", "bg-paper"],
  ["bg-stone-100/60", "bg-line/40"],
  ["bg-stone-100", "bg-line"],
  ["bg-stone-200", "bg-line"],
  ["bg-white", "bg-card"],
  ["divide-stone-100", "divide-line"],
  ["border-stone-100", "border-line"],
  ["border-stone-200", "border-line"],
  ["border-stone-300", "border-line"],
  ["border-stone-400", "border-ink-faint"],
  ["text-stone-900", "text-ink"],
  ["text-stone-800", "text-ink"],
  ["text-stone-700", "text-ink-soft"],
  ["text-stone-600", "text-ink-soft"],
  ["text-stone-500", "text-ink-soft"],
  ["text-stone-400", "text-ink-faint"],
  ["text-stone-300", "text-ink-faint"],
];

let total = 0;
for (const file of files) {
  let src = readFileSync(file, "utf8");
  const before = src;
  for (const [from, to] of LITERALS) src = src.split(from).join(to);
  // Meta/labels get IBM Plex Mono: any uppercase tracking-wide label.
  src = src.replaceAll("uppercase tracking-wide", "uppercase tracking-wide font-mono");
  if (src !== before) {
    writeFileSync(file, src);
    total++;
    console.log("themed", file);
  }
}
console.log(`\n${total} files updated`);
