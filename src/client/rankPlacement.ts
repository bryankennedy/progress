// Shared drop-placement math for every rank-ordered list (PROG-129): given a
// group's ranks in rendered order and the slot the active row lands in, mint
// the active row's new rank — plus, when the slot's neighbours don't strictly
// order, replacement ranks for the tied run around it.
//
// Ties are real: action creates race (two concurrent POSTs both append after
// the same max and mint the SAME key — the pairs that crashed PROG-129), and
// containers all start at DEFAULT_RANK. The old callers assumed neighbours
// were strictly ordered and let rankBetween throw mid-drop, which took the
// whole page down. Here a tie instead widens to the maximal run of equal
// ranks around the slot and renumbers it between its strict outer bounds —
// a handful of extra one-row writes, and the degenerate data heals itself.

import { rankBetween } from "../shared/rank";

export type Placement = {
  /** The active row's new rank. */
  rank: string;
  /** Replacement ranks for existing rows (indices into `ranks`) whose keys must
   *  move to open the slot — empty unless the drop hit a tied run. */
  heal: Array<{ index: number; rank: string }>;
};

/**
 * Rank for a row landing at `insertAt` in a group whose existing ranks (the
 * active row EXCLUDED) are `ranks`, in rendered order. Rendered order sorts by
 * rank first, so `ranks` is non-decreasing; equal neighbours are the only way
 * it fails to be strictly increasing.
 */
export function placementRanks(ranks: string[], insertAt: number): Placement {
  const before = insertAt > 0 ? ranks[insertAt - 1]! : null;
  const after = insertAt < ranks.length ? ranks[insertAt]! : null;
  if (before === null || after === null || before < after)
    return { rank: rankBetween(before, after), heal: [] };

  // The slot sits inside a run of equal ranks. Renumber the whole run (plus
  // the active row at its slot) strictly between the nearest distinct ranks
  // on either side. Walking by value, not index, keeps this correct even if a
  // caller ever passes a not-quite-sorted list: everything that compares
  // >= lowRank and <= highRank is part of the rewrite window.
  let lo = insertAt - 1;
  while (lo > 0 && ranks[lo - 1]! >= after) lo--;
  let hi = insertAt;
  while (hi < ranks.length - 1 && ranks[hi + 1]! <= before) hi++;
  const lowBound = lo > 0 ? ranks[lo - 1]! : null;
  const highBound = hi < ranks.length - 1 ? ranks[hi + 1]! : null;

  const heal: Placement["heal"] = [];
  let cursor = lowBound;
  let activeRank = "";
  for (let index = lo; index <= hi + 1; index++) {
    cursor = rankBetween(cursor, highBound);
    if (index === insertAt) activeRank = cursor;
    else {
      // Rows before the slot keep their index; rows after are shifted one
      // position in this loop because the active row occupies `insertAt`.
      const target = index < insertAt ? index : index - 1;
      if (ranks[target] !== cursor) heal.push({ index: target, rank: cursor });
    }
  }
  return { rank: activeRank, heal };
}
