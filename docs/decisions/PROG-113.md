### PROG-113 — Diary: instant store recap, server day-activity, cached AI summary

**Date:** 2026-08-03

**Context.** The Diary view (`/diary`) needs three things the existing surfaces
don't provide together: a recap of what was accomplished on a given day, an
AI-generated summary of that day, and a visual of progress across previous
days. The snapshot deliberately excludes comments/activity (D20), and nothing
in the app calls an LLM today.

**Decisions.**

1. **Day definition** — a diary day is the owner's **local calendar day** (the
   Agenda's convention, D38). The client computes the local-midnight epoch
   bounds and passes them to the server as `?from=&to=` (unix seconds), so the
   Worker never guesses a timezone. The route encodes the day as
   `/diary?date=YYYY-MM-DD` (default: today) so any day is bookmarkable.

2. **Two-wave render, honoring §2.1 instant-UI.** Wave 1 paints synchronously
   from the snapshot: actions completed that day (`completedAt`), created that
   day (`createdAt`), still-open actions touched that day (`updatedAt`), and
   the multi-day progress strip (counts of `completedAt` per day). Wave 2 is
   one server round-trip — `GET /api/diary?from=&to=` returning that day's
   `activity` rows, comments, and linked commits/PRs — which streams into the
   page a beat later, the same pattern the search page uses for comment hits
   (D20 precedent). No user interaction ever waits on it.

3. **AI summary server-side, Claude Opus 4.8, cached in D1.** A new
   `GET /api/diary/summary?date=&from=&to=` gathers the day's events, builds a
   compact prompt, and calls the Messages API via the official
   `@anthropic-ai/sdk` (Workers-compatible) with `claude-opus-4-8`. The result
   is cached in a new `diary_summaries` table keyed by the `YYYY-MM-DD` day
   with a hash of the day's event digest — a revisit returns the cached row
   instantly, and the summary regenerates only when the day's events changed
   (or via an explicit `?refresh=1`). The key rides `ANTHROPIC_API_KEY`
   (`.dev.vars` locally, `wrangler secret put` in prod, template in
   `.env.example`); when unset the endpoint answers 503 `ai_unavailable` and
   the client shows the recap without a summary — the feature degrades, never
   blocks.

4. **The diary is global, not per-user.** Activity rows carry `actorId` and the
   single-tenant trust model (D44) lets every allowlisted user see everything;
   the recap attributes events to their actors but does not filter by viewer.
   A per-user cut can layer on later without schema change.

5. **Navigation** — Diary joins the shared `nav.tsx` list (desktop header inline;
   on phones it lives in the More sheet, keeping the four primary tabs).
