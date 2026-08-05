// Display names for the fixed vocabularies (SPEC §3) — one copy shared by
// the board, pages, and the command palette.

import type { ActionPriority, ActionStatus } from "../shared/constants";

export const STATUS_LABELS: Record<ActionStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export const PRIORITY_LABELS: Record<ActionPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

// One mapping for the priority indicator (SPEC v2 §7.2, DECISIONS D39/D47,
// PROG-61): the fill color for the signal-bars glyph (PriorityIndicator).
// urgent→high→medium→low descend red→orange→gold→slate, but toned off the raw
// spectrum to sit in the "Porcelain & Moss" palette rather than reading as
// stock UI colors — urgent reuses the on-system danger tomato. Recalibrated in
// PROG-145 so every fill clears WCAG 1.4.11 (≥3:1) on the white card (high
// 5.06:1, medium 3.89:1, low 4.7:1). Defined once; used by the board, Agenda,
// action page, and container lists. `null` = "none", which renders as
// faded/empty bars (no fill of its own).
//
// PROG-150b promoted high/medium/low to theme tokens (`--color-priority-*`,
// styles.css `@theme` + brand-assets/tokens.css) — the one colored thing
// pre-mono themes couldn't reach. `var(..., #hex)` fallback matches the
// idiom StatusIndicator/EstimateIndicator/PriorityIndicator already use for
// their own tokens; the hex is the porcelain value, live only outside a
// browser context that resolves custom properties. `urgent` rides
// --color-danger directly (it has always been the danger tomato) rather than
// getting a fourth priority token — which also lets the mono preset's danger
// override reach it.
export const PRIORITY_COLORS: Record<ActionPriority, string | null> = {
  urgent: "var(--color-danger, #b23c28)",
  high: "var(--color-priority-high, #a85a20)",
  medium: "var(--color-priority-medium, #a37b16)",
  low: "var(--color-priority-low, #5a6796)",
  none: null,
};
