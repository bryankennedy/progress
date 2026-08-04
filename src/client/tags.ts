// Tag-chip lookup shared by the board and Agenda cards (PROG-83). One
// builder instead of a copy per page, so the chip order can't drift between
// views: links resolve through the snapshot's tag table and each action's
// chips list alphabetically — tags have no rank, and actionTags insertion
// order is meaningless to the reader.

import type { SnapshotPayload, WireTag } from "../shared/types";
import { sortByName } from "./boardFilters";

// ── Tag-chip tint treatment (PROG-145, audit C2) ─────────────────────────────
// Chips used to paint white 10px text on the raw tag hue — four of the seven
// brand hues failed even the 3:1 large-text bar (worst: gold at 1.65:1). Chips
// now render as tinted washes: background = the hue at 15% over the white
// card, border = the hue at 30%, text = the hue darkened until it clears
// WCAG AA (≥4.5:1) against that wash. Everything is COMPUTED from `tag.color`
// (no per-hue literals) so any future tag hue passes automatically and the
// single-theme/no-literal-colors rule (PROG-146 standing decision) holds.

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

const WHITE: Rgb = [255, 255, 255];

export interface TagChipStyle {
  backgroundColor: string;
  borderColor: string;
  color: string;
}

// Seven brand hues in practice, so memoize the per-hue math.
const chipCache = new Map<string, TagChipStyle>();

export function tagChipStyle(hue: string): TagChipStyle {
  const cached = chipCache.get(hue);
  if (cached) return cached;
  const rgb = hexToRgb(hue);
  const backgroundColor = rgbToHex(mix(rgb, WHITE, 0.15));
  const borderColor = rgbToHex(mix(rgb, WHITE, 0.3));
  // Darken the hue (scale toward black — hue-preserving) until it reads AA
  // against the wash. Terminates: near-black clears 4.5:1 on any 15% wash.
  let text = rgb;
  let k = 1;
  while (contrastRatio(rgbToHex(text), backgroundColor) < 4.5 && k > 0.05) {
    k -= 0.05;
    text = [rgb[0] * k, rgb[1] * k, rgb[2] * k];
  }
  const style: TagChipStyle = { backgroundColor, borderColor, color: rgbToHex(text) };
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
