// Client-side workspace search (PROG-130). Title and description are already in
// the store (D20), so this runs in memory with no round-trip — it's the instant
// half of the two-wave search; comments stream in separately via /api/search.
// Matching is case-insensitive substring, AND'd across whitespace terms (every
// term must appear somewhere), and a hit ranks by WHERE the terms land — title
// beats description — so "the issue I'm thinking of" sorts above one that merely
// mentions the word in its body. Pure functions, unit-tested in search.test.ts.

import type { WireIssue, WorkspacePayload } from "../shared/types";

// The slice of a container row that search reads — every container (initiative,
// product, repo, arc) carries these, so one shape covers all four.
type SearchableContainer = {
  id: string;
  name: string;
  description: string;
  archivedAt: string | null;
};

// Title hits weigh more than description hits; the gap is what makes a
// title-matching issue outrank a description-only one regardless of term count.
const TITLE_WEIGHT = 3;
const DESC_WEIGHT = 1;

export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// Score one title/description pair, or null when any term is absent from both
// (so a result requires every term to appear). `inTitle` is true when at least
// one term landed in the title — the UI uses it to mark description-only hits.
function scoreFields(
  terms: string[],
  title: string,
  description: string,
): { score: number; inTitle: boolean } | null {
  const t = title.toLowerCase();
  const d = description.toLowerCase();
  let score = 0;
  let inTitle = false;
  for (const term of terms) {
    const hitTitle = t.includes(term);
    const hitDesc = d.includes(term);
    if (!hitTitle && !hitDesc) return null;
    if (hitTitle) inTitle = true;
    score += hitTitle ? TITLE_WEIGHT : DESC_WEIGHT;
  }
  // A title that starts with the first term is a strong "this is the one"
  // signal for quick-jump — nudge it above mid-title matches of equal weight.
  if (terms[0] && t.startsWith(terms[0])) score += 1;
  return { score, inTitle };
}

// Newer first; ISO timestamps compare lexically, so a string compare is enough.
function byRecency(a: { updatedAt: string }, b: { updatedAt: string }): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

export type IssueHit = { issue: WireIssue; score: number; inTitle: boolean };

export function searchIssues(ws: WorkspacePayload, query: string, limit = 8): IssueHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const hits: IssueHit[] = [];
  for (const issue of ws.issues) {
    const scored = scoreFields(terms, issue.title, issue.description);
    if (scored) hits.push({ issue, score: scored.score, inTitle: scored.inTitle });
  }
  hits.sort((a, b) => b.score - a.score || byRecency(a.issue, b.issue));
  return limit > 0 ? hits.slice(0, limit) : hits;
}

// Empty-query browse (PROG-78): "searching for nothing" is valid on the search
// page when filters are active — every issue becomes a zero-score hit, newest
// first, and the caller's filters decide what actually shows. `inTitle` is true
// so the row renders without a description snippet (there is no matched term
// for a snippet to explain).
export function browseIssues(ws: WorkspacePayload): IssueHit[] {
  return ws.issues
    .map((issue) => ({ issue, score: 0, inTitle: true }))
    .sort((a, b) => byRecency(a.issue, b.issue));
}

export type ContainerKind = "initiative" | "product" | "repo" | "arc";
export type ContainerHit = {
  id: string;
  kind: ContainerKind;
  name: string;
  href: string;
  score: number;
};

const CONTAINER_LABEL: Record<ContainerKind, string> = {
  initiative: "Initiative",
  product: "Product",
  repo: "Repo",
  arc: "Arc",
};

export function containerLabel(kind: ContainerKind): string {
  return CONTAINER_LABEL[kind];
}

// Containers carry a name + description like issues do, so they score the same
// way (name plays the role of title). Archived ones stay out of search — they're
// reachable from their parent's page, which lists them dimmed (D26).
export function searchContainers(ws: WorkspacePayload, query: string, limit = 6): ContainerHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const sources: { kind: ContainerKind; rows: SearchableContainer[] }[] = [
    { kind: "initiative", rows: ws.initiatives },
    { kind: "product", rows: ws.products },
    { kind: "repo", rows: ws.repos },
    { kind: "arc", rows: ws.arcs },
  ];
  const hits: ContainerHit[] = [];
  for (const { kind, rows } of sources) {
    for (const row of rows) {
      if (row.archivedAt) continue;
      const scored = scoreFields(terms, row.name, row.description);
      if (scored) {
        hits.push({ id: row.id, kind, name: row.name, href: `/${kind}/${row.id}`, score: scored.score });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return limit > 0 ? hits.slice(0, limit) : hits;
}

export type Segment = { text: string; match: boolean };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Split `text` into matched / unmatched runs for highlighting. Terms are OR'd
// into one case-insensitive regex; adjacent/overlapping matches collapse into
// the surrounding segment naturally because the regex walks left to right.
export function highlight(text: string, terms: string[]): Segment[] {
  if (terms.length === 0) return [{ text, match: false }];
  const re = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index;
    if (start > last) out.push({ text: text.slice(last, start), match: false });
    out.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}
