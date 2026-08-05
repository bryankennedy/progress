// Tag-chip lookup shared by the board and Agenda cards (PROG-83). One
// builder instead of a copy per page, so the chip order can't drift between
// views: links resolve through the snapshot's tag table and each action's
// chips list alphabetically — tags have no rank, and actionTags insertion
// order is meaningless to the reader.

import type { SnapshotPayload, WireTag } from "../shared/types";
import { sortByName } from "./boardFilters";

// ── Tag-chip tint treatment (PROG-145, audit C2; PROG-150 ripple check) ──────
// Chips used to paint white 10px text on the raw tag hue — four of the seven
// brand hues failed even the 3:1 large-text bar (worst: gold at 1.65:1). Chips
// now render as tinted washes: background = the hue at 15% over the card,
// border = the hue at 30%, text = the hue darkened until it clears WCAG AA
// (≥4.5:1) against that wash. Everything is COMPUTED from `tag.color` (no
// per-hue literals) so any future tag hue passes automatically and the
// no-literal-colors component rule (PROG-146 standing decision) holds.
//
// PROG-150 added theme presets, so "the card" is no longer always white:
// background/border are now CSS `color-mix(in srgb, <hue> N%, var(--color-card))`
// expressions — they resolve against whichever theme is live, no JS involved.
// The precomputed `color` text value can't do the same (color-mix output
// isn't readable back from JS without a live DOM), so it's darkened until it
// clears AA against the wash over EVERY theme's card, not just white — the
// three current theme cards are all near-white (porcelain #ffffff, adobe
// #fdfaf3, sanzo #fefbf3), so one hex passes all of them; update CARD_COLORS
// if a future theme's card drifts further from white.
//
// mono (PROG-150b) needs the hue itself neutralized, which color-mix and this
// module's JS math can't do without a live DOM (color-mix output isn't
// readable back into JS). Its card is #ffffff — identical to porcelain's, so
// no CARD_COLORS change — and every chip gets a `grayscale(1)` CSS filter
// scoped to `:root[data-theme="mono"] .tag-chip` (styles.css) at render time
// instead: grayscale is luminance-preserving, so the wash/border/text
// contrast ratios computed here survive the filter unchanged. Every render
// site adds the stable `tag-chip` class alongside this style object.

type Rgb = [number, number, number];

const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

const rgbToHex = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

// `t` of a over (1-t) of b — simple sRGB blend, the same math the old
// translucent overlays resolved to.
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] * t + b[0] * (1 - t),
  a[1] * t + b[1] * (1 - t),
  a[2] * t + b[2] * (1 - t),
];

// WCAG 2.x relative luminance + contrast ratio.
const luminance = ([r, g, b]: Rgb) => {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

export const contrastRatio = (a: string, b: string) => {
  const [la, lb] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

// The three theme cards (PROG-150) — all near-white, but not identical, so
// the darkening loop below checks against each rather than assuming white.
const CARD_COLORS: Rgb[] = [hexToRgb("#ffffff"), hexToRgb("#fdfaf3"), hexToRgb("#fefbf3")];

export interface TagChipStyle {
  backgroundColor: string;
  borderColor: string;
  color: string;
}

// Seven brand hues in practice, so memoize the per-hue math.
const chipCache = new Map<string, TagChipStyle>();

// Worst-case (lowest) contrast of `text` against the 15% wash, across every
// theme card — the loop below darkens until even the least favorable theme
// clears AA.
const worstWashRatio = (text: Rgb, hueRgb: Rgb): number =>
  Math.min(
    ...CARD_COLORS.map((card) => contrastRatio(rgbToHex(text), rgbToHex(mix(hueRgb, card, 0.15)))),
  );

export function tagChipStyle(hue: string): TagChipStyle {
  const cached = chipCache.get(hue);
  if (cached) return cached;
  const rgb = hexToRgb(hue);
  // Darken the hue (scale toward black — hue-preserving) until it reads AA
  // against the wash on every theme card. Terminates: near-black clears
  // 4.5:1 on any 15% wash over a near-white card.
  let text = rgb;
  let k = 1;
  while (worstWashRatio(text, rgb) < 4.5 && k > 0.05) {
    k -= 0.05;
    text = [rgb[0] * k, rgb[1] * k, rgb[2] * k];
  }
  const style: TagChipStyle = {
    backgroundColor: `color-mix(in srgb, ${hue} 15%, var(--color-card))`,
    borderColor: `color-mix(in srgb, ${hue} 30%, var(--color-card))`,
    color: rgbToHex(text),
  };
  chipCache.set(hue, style);
  return style;
}

export function tagsByAction(ws: SnapshotPayload): Map<string, WireTag[]> {
  const tagById = new Map(ws.tags.map((t) => [t.id, t]));
  const map = new Map<string, WireTag[]>();
  for (const link of ws.actionTags) {
    const tag = tagById.get(link.tagId);
    if (!tag) continue;
    const list = map.get(link.actionId) ?? [];
    list.push(tag);
    map.set(link.actionId, list);
  }
  for (const [actionId, list] of map) map.set(actionId, sortByName(list));
  return map;
}
