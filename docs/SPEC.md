# Progress — Product Spec & Roadmap (v2)

> The **why** (vision, principles) and the **not-yet-built** (plans, in
> deliberate future tense). The system **as built** lives in
> [`REFERENCE.md`](./REFERENCE.md); rationale in [`DECISIONS.md`](./DECISIONS.md);
> how-to in [`SETUP.md`](./SETUP.md).
>
> This is the **v2** roadmap. v1 — the personal product-development tracker —
> shipped and was dogfooded; its completed roadmap is frozen at
> [`archive/SPEC-v1.md`](./archive/SPEC-v1.md). Pre-v2 `SPEC §X` citations in
> code and decisions refer to that archived document. Section numbers **here**
> are stable for v2 and start fresh; when an area ships, shrink its section to
> intent + a pointer into `REFERENCE.md` rather than renumbering.
>
> **Status: v2 shipped 2026-06-17** (deploy + dogfood pass). The headline work —
> broadened domain (§3), frictionless structure creation (§4), due dates (§5),
> and the Agenda view + priority indicator (§6–§7) — is built and in production;
> those sections are now shrunk to intent + a pointer into `REFERENCE.md`.
> Build-time decisions: DECISIONS **D37–D40**. The remaining content here is the
> genuinely forward-looking part (§8 direction). Next likely step: recurring due
> dates (§8).

## 1. Where v1 left off, and why v2

v1 made Progress a "personal Linear" for **building products**: the hierarchy
Initiative → Product → Repo/Arc → Issue (renamed by PROG-98 to Workspace →
Focus → Repo/Arc → Action), an instant load-everything client, a
command palette, GitHub linking, and a Claude Code agent surface (context
bundle, MCP server, work kickoff). It runs in production and manages its own
backlog.

v2 broadens the *subject matter* without diluting the tool. The owner wants one
place for **everything they're responsible for** — not just software, but
personal and household work too — and the day-to-day question those tasks raise
is **"what's due and when."** So v2 is two moves:

1. Make Progress comfortable for **non-dev work** — frictionless structure
   creation, and a first-class life for products that have no repo.
2. Add the **time dimension** v1 deliberately omitted — **due dates** and an
   **Agenda** view that answers "what's due" at a glance.

## 2. Product principles (carried forward, unchanged)

1. **Speed is a feature.** The whole snapshot in the client store; every
   mutation optimistic; no spinner on any interaction. Everything v2 adds
   renders from memory (§7.1).
2. **Rigid simplicity over configurability.** One fixed status set, one way to
   do things. v2 adds fields and views, **not** knobs.
3. **The owner's nouns, exactly.** Workspace → Focus → Arc → Action
   (→ Step) — the hierarchy was **unchanged in v2** (§3), renamed once by
   PROG-98 (from Initiative → Product → Repo/Arc → Issue), then simplified by
   **PROG-102**, which demoted **Repo** from a container to the focus's optional
   `gitUrl` field. "Epic" and "project" remain banned words.
4. **Paper-y, calm UI.** Light, typography-led, mobile-friendly.

## 3. The broadened domain (same nouns, wider meaning) — **shipped**

**Intent:** the existing nouns stretch to *any area of responsibility* without a
vocabulary change — a **Focus** is a software product *or* "Household" /
"Finances" / "Health"; the git repo a focus mirrors is dev-specific and
**optional** (a plain `gitUrl` field since PROG-102), so repo-less focuses are
first-class; an **Arc** is a sub-area/theme; an **Action** is a task (now with a
due date, §5). v2 shipped this by reusing "Product" for a life-area — one small
mental stretch that kept rigid simplicity / settled schema; PROG-98 later removed
the stretch by renaming the nouns (Workspace/Focus/Action/Step) without changing
the shape.

Shipped: repo-less focuses carry no repo-only affordances. **PROG-102** then
retired the Repo container outright — a focus optionally carries a `gitUrl`
instead — so the "wider meaning" is now the *only* meaning. See `REFERENCE.md`
§2 (domain model) and DECISIONS **D36**, **PROG-102**.

## 4. Frictionless structure creation — **shipped**

**Intent** (*"create products, arcs, and initiatives while making an issue and
on their own from the dashboard"*): make structure creation discoverable and
inline, not a palette-only power move.

Shipped — a persistent **New** menu in the app header (Action · Workspace ·
Focus · Arc; Repo was dropped by PROG-102), inline **"+ New focus / + New arc"**
in the create-action dialog (folding in the deferred "add arc from the New Issue
modal"), and a dedicated **`/structure`** route (the Workspace → Focus → Arc
tree with inline "+ add"). All reuse the v1 optimistic container write paths
(D26) — surfaces only, no new endpoints. See `REFERENCE.md` §5 and
DECISIONS **D40**.

## 5. Due dates — **shipped**

**Intent** (*"for these tasks I need to track a due date"*): an optional,
date-only, timezone-safe due date — a wall-calendar day identical everywhere,
not an instant.

Shipped — a nullable `due_date` (on `issues`, now the `actions` table after
PROG-98), stored as ISO `YYYY-MM-DD` text (D37); validated in POST/PATCH;
editable from the action-page sidebar, the new-action dialog, the
command-palette `D` picker (relative quick-picks or a typed date),
and inline in Agenda rows. Rides the snapshot payload, so every view computes
from memory. See `REFERENCE.md` §2–§3, §5.

**Still out of scope** (the genuinely forward-looking part): recurring due
dates, reminders/digests, start dates, date+time — §8. Recurrence is the likely
next step; the field and Agenda were built not to preclude it.

## 6. The Agenda view — **shipped**

**Intent** (*"a list of issues ordered by due date, each with a visual priority
indicator"*): the time-driven cut that answers "what's due."

Shipped at **`/agenda`** — every dated, pending action (done/canceled excluded),
sorted by due date ascending and grouped **Overdue · Today · This week · Later**
(local day; "this week" = rolling 7 days, D38). Each row: priority indicator,
key, title, relative due phrase, focus/arc, status; overdue rows distinct.
Filterable by focus/arc/tag via URL params; inline mark-done and bump-due.
Renders entirely from the store. See `REFERENCE.md` §5.

## 7. Supporting pieces — **shipped**

- **7.1 It stays instant.** Due dates ride the snapshot payload; the Agenda,
  the priority indicator, and inline structure creation all render/mutate from
  the store via the optimistic template (D21). A spinner is a bug (§2.1).
- **7.2 Priority, made visible.** A single reusable **priority indicator** — a
  color-coded dot for the fixed urgent/high/medium/low/none scale, "none" a
  hollow ring; one mapping, no configuration. Used by the Agenda, free for the
  board/lists. See DECISIONS **D39**.

## 8. Beyond this phase (direction, not commitment)

- **Search — shipped** (PROG-130): a `/` quick-jump modal + a filterable
  `/search` page over titles, descriptions, and comments. See REFERENCE §5
  (Search) and §3 (`GET /api/search`). Possible follow-ons: typo-tolerant/fuzzy
  matching and saved searches (both deliberately out of the first cut).
- **Recurring tasks** — the natural follow-on for household chores; the due-date
  model and Agenda are built not to block it.
- **Reminders / a daily "what's due" digest.**
- **Start dates** (scheduled-but-not-yet-actionable) and date+time where a task
  is genuinely appointment-like.
- Carry-overs from v1.x: PR-driven status automation, cloud/headless work
  kickoff (archived SPEC §11.2 "Later").

## 9. Open questions — **all closed**

Settled at build time and recorded in `DECISIONS.md`:

1. **Agenda's place in navigation** → top-level `/agenda` (D38).
2. **"This week" definition** → rolling 7 days (D38).
3. **Priority indicator visual language** → a color-coded dot, "none" a hollow
   ring (D39).
4. **Structure overview vs. home dashboard** → a dedicated `/structure` route
   (D40).
5. **Due-date storage** → ISO `YYYY-MM-DD` text (D37).

## 10. Architecture & data notes

- **One schema change:** add a nullable `due_date` (calendar date) to `issues`
  (now `actions`, PROG-98), via the standard Drizzle migration flow (SETUP §2).
  It then flows into the snapshot payload automatically.
- **No new write endpoints** for structure creation — v2 reuses the v1 container
  routes (D26); the work is client surfaces + inline creation.
- **Everything else is client-side:** Agenda bucketing/sorting, the priority
  indicator, and relative-date formatting all run in the store-backed client,
  preserving §2.1.

## 11. Suggested sequence — **built in this order**

1. ✅ **Repo-less focuses first-class** + inline / dashboard creation surfaces
   (§3–§4).
2. ✅ **Due-date field** end-to-end (§5): schema → snapshot payload → action
   page → new-action → palette picker.
3. ✅ **Agenda view** + **priority indicator** (§6–§7.2) — the headline of v2.

Recorded in production as the **v2 — Broaden & Due dates** arc
(`scripts/dogfood-v2.ts`). Next phase candidate: recurring due dates (§8).
