// The single, reusable estimate indicator (PROG-101), sibling to
// PriorityIndicator/StatusIndicator: a gauge that fills from the bottom in
// proportion to where the estimate sits in the fixed scale (ACTION_ESTIMATES —
// 0 points is a valid, empty gauge; 8 fills it). Size reads as "how full",
// with the exact number carried by title/aria (and shown beside the glyph in
// every UI that renders it). Neutral ink tone — unlike status/priority, an
// estimate has no urgency semantics for color to encode. No estimate renders
// the same empty gauge dashed, matching how "not set" reads elsewhere.

import { ACTION_ESTIMATES } from "../shared/constants";

const TRACK = "var(--color-ink-faint, #9a8b73)";
const FILL = "var(--color-ink-soft, #6b5f4d)";

// Inner fill area of the gauge (inside the 1.5-stroke outline).
const INNER = { x: 5, yTop: 4.75, yBottom: 11.25, w: 6 };

export default function EstimateIndicator({
  estimate,
  className = "",
}: {
  estimate: number | null;
  className?: string;
}) {
  const label = estimate === null ? "No estimate" : `${estimate} point${estimate === 1 ? "" : "s"}`;
  // Position on the fixed scale; an off-scale value clamps to full.
  const idx = estimate === null ? 0 : ACTION_ESTIMATES.indexOf(estimate as never);
  const fraction =
    estimate === null
      ? 0
      : (idx === -1 ? ACTION_ESTIMATES.length - 1 : idx) / (ACTION_ESTIMATES.length - 1);
  const h = (INNER.yBottom - INNER.yTop) * fraction;
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      className={`inline-block h-3.5 w-3.5 shrink-0 ${className}`}
    >
      <title>{label}</title>
      <rect
        x="2.75"
        y="2.75"
        width="10.5"
        height="10.5"
        rx="2.5"
        fill="none"
        stroke={TRACK}
        strokeWidth="1.5"
        strokeDasharray={estimate === null ? "2.2 1.9" : undefined}
        opacity={estimate === null ? 0.7 : 1}
      />
      {h > 0 && (
        <rect x={INNER.x} y={INNER.yBottom - h} width={INNER.w} height={h} rx="1" fill={FILL} />
      )}
    </svg>
  );
}
