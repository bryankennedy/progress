// The single, reusable priority indicator (SPEC v2 §7.2, DECISIONS D39/D47,
// PROG-61): Linear-style ascending signal bars. Priority is encoded by BOTH
// shape (how many of the three bars are filled) AND color (the toned, on-palette
// PRIORITY_COLORS), so rank reads at a glance and survives grayscale / color
// blindness — color alone never carries the meaning. Urgent breaks the pattern
// with a filled badge + exclamation so the most pressing work pops on a dense
// board. One mapping (labels.ts PRIORITY_COLORS), no configuration. Used by the
// board, Agenda, action page, and container lists.

import type { ActionPriority } from "../shared/constants";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "./labels";

// How many of the three bars are filled per level. Urgent renders its own glyph
// (the count is unused for it).
const FILLED_BARS: Record<ActionPriority, number> = {
  urgent: 3,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

// Three bottom-aligned ascending bars in a 16×16 box.
const BARS = [
  { x: 2.5, y: 9, h: 5 },
  { x: 6.5, y: 5, h: 9 },
  { x: 10.5, y: 1, h: 13 },
];

// Unfilled bars: a faint neutral track so the empty steps read as "not set",
// matching how "none" used to render (the old hollow ring used this same token).
const TRACK = "var(--color-ink-faint, #9a8b73)";

export default function PriorityIndicator({
  priority,
  className = "",
}: {
  priority: ActionPriority;
  className?: string;
}) {
  const color = PRIORITY_COLORS[priority] ?? TRACK;
  const filled = FILLED_BARS[priority];
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      // title/aria carry the meaning; the glyph is a visual shorthand.
      aria-label={PRIORITY_LABELS[priority]}
      className={`inline-block h-3.5 w-3.5 shrink-0 ${className}`}
    >
      <title>{PRIORITY_LABELS[priority]}</title>
      {priority === "urgent" ? (
        <>
          <rect x="2" y="2" width="12" height="12" rx="3" fill={color} />
          <rect x="7.25" y="4.25" width="1.5" height="5" rx="0.75" fill="#fff" />
          <circle cx="8" cy="11.25" r="1" fill="#fff" />
        </>
      ) : (
        BARS.map((b, i) => (
          <rect
            key={b.x}
            x={b.x}
            y={b.y}
            width="3"
            height={b.h}
            rx="1"
            fill={i < filled ? color : TRACK}
            opacity={i < filled ? 1 : 0.3}
          />
        ))
      )}
    </svg>
  );
}
