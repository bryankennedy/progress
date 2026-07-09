// The single, reusable status indicator (PROG-101), sibling to
// PriorityIndicator: a Linear-style circle glyph whose meaning is encoded by
// BOTH shape and color, so it reads at a glance and survives grayscale.
// Workflow progress maps to how much of the circle is drawn/filled — backlog a
// dashed outline, todo a solid outline, in_progress a half pie, in_review a
// three-quarter pie, done a filled disc with a check — and the two colors
// follow the palette's semantic roles (--adobe = active/"now" for the two
// in-flight states, --moss = completed for done). Canceled breaks the
// progression with a faint disc and an ✕: closed, but nothing shipped. One
// mapping, no configuration.

import type { ActionStatus } from "../shared/constants";
import { STATUS_LABELS } from "./labels";

// Faint neutral for the not-started outlines and the canceled disc — the same
// "not set" track PriorityIndicator uses.
const TRACK = "var(--color-ink-faint, #9a8b73)";
const ACTIVE = "var(--color-adobe, #bb6f50)";
const REVIEW = "var(--color-adobe-deep, #8f5340)";
const DONE = "var(--color-moss, #79864c)";

export default function StatusIndicator({
  status,
  className = "",
}: {
  status: ActionStatus;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      // title/aria carry the meaning; the glyph is a visual shorthand.
      aria-label={STATUS_LABELS[status]}
      className={`inline-block h-3.5 w-3.5 shrink-0 ${className}`}
    >
      <title>{STATUS_LABELS[status]}</title>
      {glyph(status)}
    </svg>
  );
}

// The ring every open state shares; fill/arc goes inside it at r=4.
function Ring({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <circle
      cx="8"
      cy="8"
      r="6"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeDasharray={dashed ? "2.4 2.1" : undefined}
    />
  );
}

// A pie wedge from 12 o'clock, clockwise through `fraction` of the circle.
function Pie({ fraction, color }: { fraction: number; color: string }) {
  const angle = 2 * Math.PI * fraction;
  const x = 8 + 4 * Math.sin(angle);
  const y = 8 - 4 * Math.cos(angle);
  const largeArc = fraction > 0.5 ? 1 : 0;
  return <path d={`M8 8 L8 4 A4 4 0 ${largeArc} 1 ${x} ${y} Z`} fill={color} />;
}

function glyph(status: ActionStatus) {
  switch (status) {
    case "backlog":
      return <Ring color={TRACK} dashed />;
    case "todo":
      return <Ring color={TRACK} />;
    case "in_progress":
      return (
        <>
          <Ring color={ACTIVE} />
          <Pie fraction={0.5} color={ACTIVE} />
        </>
      );
    case "in_review":
      return (
        <>
          <Ring color={REVIEW} />
          <Pie fraction={0.75} color={REVIEW} />
        </>
      );
    case "done":
      return (
        <>
          <circle cx="8" cy="8" r="7" fill={DONE} />
          <path
            d="M4.75 8.4 L7 10.6 L11.25 5.9"
            fill="none"
            stroke="#fff"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case "canceled":
      return (
        <>
          <circle cx="8" cy="8" r="7" fill={TRACK} />
          <path
            d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5"
            stroke="#fff"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </>
      );
  }
}
