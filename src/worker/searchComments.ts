// Pure helpers for comment search (PROG-130). The Drizzle query lives in the
// route handler; the escaping + snippet logic is here so it's unit-testable
// (searchComments.test.ts), mirroring bundle.ts / bundle.test.ts.

// Page size for returned matches. The handler pulls one extra row to detect
// whether more pages exist; the client asks for the next page via ?offset=
// (PROG-78 pagination).
export const SEARCH_CAP = 50;

// Ceiling on ?offset=. Beyond it parseOffset clamps, so the window can no
// longer advance — pagination must stop advertising more pages at this point
// (see hasMorePages) or a clamped offset would serve the same page forever.
export const MAX_OFFSET = 10_000;

// Parse the ?offset= param defensively: anything that isn't a non-negative
// integer (absent, garbage, negative, fractional, huge) clamps to a safe value
// rather than erroring — a malformed bookmark should degrade to page one.
export function parseOffset(raw: string | undefined, max = MAX_OFFSET): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, max);
}

// Whether `truncated` should report another page: the query produced more rows
// than the page holds AND the next offset is still below the clamp ceiling. At
// MAX_OFFSET the answer is no even mid-match-set, ending pagination cleanly
// instead of letting the client refetch the same clamped page in a loop.
export function hasMorePages(rowCount: number, offset: number): boolean {
  return rowCount > SEARCH_CAP && offset < MAX_OFFSET;
}

// Escape LIKE wildcards so a query like "100%" or "a_b" matches literally.
// Backslash is the ESCAPE character (see the route's `ESCAPE '\\'`), so it must
// be escaped first or it would consume the following character.
export function escapeLike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/[%_]/g, (ch) => `\\${ch}`);
}

// A window of `body` around the first occurrence of any term, with leading/
// trailing ellipses when truncated. Display-only — the client re-highlights the
// terms (it knows the query). `terms` are expected lowercased.
export function commentSnippet(body: string, terms: string[], radius = 60): string {
  const lower = body.toLowerCase();
  let first = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (first === -1 || idx < first)) first = idx;
  }
  if (first === -1) first = 0; // every term matched in SQL, so this is defensive
  const start = Math.max(0, first - radius);
  const end = Math.min(body.length, first + radius * 2);
  const slice = body.slice(start, end).trim();
  return `${start > 0 ? "… " : ""}${slice}${end < body.length ? " …" : ""}`;
}
