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

// "Closed" issues are terminal — done (shipped) or canceled (abandoned). The
// rest (backlog/todo/in_progress/in_review) are still open / in play. The arc
// work-order ("copy as prompt" for a whole arc) bundles only the open ones.
export const CLOSED_ISSUE_STATUSES = ["done", "canceled"] as const satisfies readonly IssueStatus[];
export const isOpenStatus = (s: IssueStatus): boolean =>
  !(CLOSED_ISSUE_STATUSES as readonly IssueStatus[]).includes(s);

export const ISSUE_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

// Linear-style points (SPEC §9 open question #1, default taken).
export const ISSUE_ESTIMATES = [0, 1, 2, 3, 5, 8] as const;

// Linked pull-request lifecycle (SPEC §5). "merged" is terminal; GitHub
// reports it as closed + merged flag, normalized at the webhook.
export const PR_STATES = ["open", "merged", "closed"] as const;
export type PrState = (typeof PR_STATES)[number];

// Tag auto-color (SPEC §9 open question #3, minimal default): fixed palette,
// color chosen by a stable hash of the name. Shared so the client's
// optimistic tag rows get the same color the server will assign.
export const TAG_COLORS = [
  "#06A7E0",
  "#F08B23",
  "#F2C42E",
  "#ED6245",
  "#546EB4",
  "#BA94C4",
  "#D4569F",
] as const;

export const tagColor = (name: string) =>
  TAG_COLORS[[...name].reduce((n, ch) => n + ch.codePointAt(0)!, 0) % TAG_COLORS.length]!;
