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

// One mapping for the priority indicator (SPEC v2 §7.2, DECISIONS D39): a small
// color-coded dot, on the global palette. urgent→high→medium→low descend
// red→orange→yellow→slate; "none" is a hollow gray ring (defined once, used by
// the Agenda and free for the board/lists to adopt). `null` = the fill color
// for the hollow none case.
export const PRIORITY_COLORS: Record<IssuePriority, string | null> = {
  urgent: "#ED6245",
  high: "#F08B23",
  medium: "#F2C42E",
  low: "#546EB4",
  none: null,
};
