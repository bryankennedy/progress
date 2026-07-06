// Fractional index keys for board ordering (PROG-43). A rank is a string over a
// fixed, ASCII-ordered alphabet that sorts lexicographically. Because there is
// always a key strictly *between* any two distinct keys, an issue can be placed
// at an exact position on the kanban board with a SINGLE write — no renumbering
// of its neighbors — which is what keeps reordering optimistic and instant
// (Hard requirement #1). Shared verbatim by the server (assign on create /
// validate on PATCH) and the client (compute the drop position); kept
// dependency-free like the rest of `src/shared`.
//
// The alphabet is base-62 in ASCII order, so a byte-wise string comparison
// (SQLite's default, JS's default) equals digit-value comparison. The migration
// backfills existing rows with fixed-width *decimal* keys ("0".."9" only) — a
// valid subset of this alphabet — so those keys interleave correctly with keys
// minted here.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = ALPHABET.length; // 62

const val = (ch: string): number => ALPHABET.indexOf(ch);
const digit = (n: number): string => ALPHABET[n]!;
const MID = Math.floor(BASE / 2);

/** True if `s` is a non-empty string over the rank alphabet. */
export function isValidRank(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && [...s].every((ch) => val(ch) >= 0);
}

/**
 * Shortest key that sorts strictly between `before` and `after`.
 *
 * `before === null` means "before everything" (start of the list); `after ===
 * null` means "after everything" (end of the list). `before` must sort before
 * `after` when both are given. Treats each key as a base-62 fraction `0.d₀d₁…`
 * and emits the shortest fraction landing in the open interval.
 */
export function rankBetween(before: string | null, after: string | null): string {
  const a = before ?? "";
  if (after !== null && a >= after) {
    throw new Error(`rankBetween: ${JSON.stringify(before)} does not sort before ${JSON.stringify(after)}`);
  }
  let b: string | null = after;
  let prefix = "";
  // The interval shrinks by at least one digit per step, so this terminates
  // well within the cap; the cap only guards against a logic bug looping.
  for (let i = 0; i < 1024; i++) {
    const lo = i < a.length ? val(a[i]!) : 0;
    const hi = b === null ? BASE : i < b.length ? val(b[i]!) : 0;

    // Room for a digit strictly between the bounds at this position: place the
    // midpoint and we're done.
    if (hi - lo >= 2) return prefix + digit(lo + Math.floor((hi - lo) / 2));

    if (i >= a.length) {
      // `a` is exhausted, so any extension of `prefix` already exceeds it; we
      // only need to stay below `b` (lo is 0 here). Every key we emit ends in a
      // non-zero digit so two stored keys are never an unsubdividable a / a+"0"
      // pair — assuming inputs are likewise zero-terminated-free (canonical),
      // which both the migration backfill and this function guarantee.
      if (b === null) return prefix + digit(MID);
      if (hi === 1) return prefix + digit(0) + digit(MID); // dip one level below b
      // hi === 0: b runs along a zero digit here. Descend (a non-zero digit of
      // b lies ahead, since b is canonical) so the final emitted digit is
      // non-zero rather than stranding on a trailing "0".
      prefix += digit(0);
      continue;
    }

    if (hi - lo === 1) {
      // Bounds are adjacent digits: commit to the lower one and drop the upper
      // bound (any continuation now stays below `b`).
      prefix += digit(lo);
      b = null;
    } else {
      // Identical digit at this position: descend.
      prefix += digit(lo);
    }
  }
  throw new Error("rankBetween: exceeded max depth");
}

/** Rank for a new last item (appended after `last`, or first if the list is empty). */
export function rankAfter(last: string | null): string {
  return rankBetween(last, null);
}

/**
 * The shared default rank for reorderable containers (PROG-87): the alphabet's
 * midpoint, i.e. `rankBetween(null, null)`. Every untouched row ties here and
 * the client's rank-then-name sort falls back to the name, so a group nobody
 * has reordered reads alphabetically. The first drag in a tied group renumbers
 * the whole group (`containerReorderRanks`, src/client/containerReorder.ts).
 */
export const DEFAULT_RANK = digit(MID);
