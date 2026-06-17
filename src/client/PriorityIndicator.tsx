// The single, reusable priority indicator (SPEC v2 §7.2, DECISIONS D39): a
// small color-coded dot for the fixed urgent/high/medium/low/none scale. One
// mapping (labels.ts PRIORITY_COLORS), no configuration. Used in Agenda rows;
// the board and issue lists are free to adopt it.

import type { IssuePriority } from "../shared/constants";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "./labels";

export default function PriorityIndicator({
  priority,
  className = "",
}: {
  priority: IssuePriority;
  className?: string;
}) {
  const color = PRIORITY_COLORS[priority];
  return (
    <span
      // title doubles as the accessible label — the dot alone is decorative.
      title={PRIORITY_LABELS[priority]}
      aria-label={PRIORITY_LABELS[priority]}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`}
      style={
        color
          ? { backgroundColor: color }
          : // none: a hollow ring so it reads as "unset", not low-but-colored.
            { boxShadow: "inset 0 0 0 1.5px var(--color-stone-300, #d6d3d1)" }
      }
    />
  );
}
