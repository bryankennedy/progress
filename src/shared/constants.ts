// Fixed vocabularies (SPEC §3 — rigid simplicity, not configurable). Shared
// verbatim by the Drizzle schema, the API's validation, and the client; this
// file must stay dependency-free so the client bundle never pulls in ORM code.

export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

// Linear-style points (SPEC §9 open question #1, default taken).
export const ISSUE_ESTIMATES = [0, 1, 2, 3, 5, 8] as const;
