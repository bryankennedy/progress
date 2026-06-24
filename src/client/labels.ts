// Display names for the fixed vocabularies (SPEC §3) — one copy shared by
// the board, pages, and the command palette.

import type { IssuePriority, IssueStatus } from "../shared/constants";

export const STATUS_LABELS: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export const PRIORITY_LABELS: Record<IssuePriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

// One mapping for the priority indicator (SPEC v2 §7.2, DECISIONS D39/D47,
// PROG-61): the fill color for the signal-bars glyph (PriorityIndicator).
// urgent→high→medium→low descend red→orange→gold→slate, but toned off the raw
// spectrum to sit in the app's warm "Adobe & Moss" palette rather than reading
// as stock UI colors — urgent reuses the on-system danger tomato. Defined once;
// used by the board, Agenda, issue page, and container lists. `null` = "none",
// which renders as faded/empty bars (no fill of its own).
export const PRIORITY_COLORS: Record<IssuePriority, string | null> = {
  urgent: "#b23c28",
  high: "#bd6a30",
  medium: "#c79a31",
  low: "#6f7896",
  none: null,
};
