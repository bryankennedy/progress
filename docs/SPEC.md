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

## 1. Where v1 left off, and why v2

v1 made Progress a "personal Linear" for **building products**: the hierarchy
Initiative → Product → Repo/Arc → Issue, an instant load-everything client, a
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

1. **Speed is a feature.** Whole workspace in the client store; every mutation
   optimistic; no spinner on any interaction. Everything v2 adds renders from
   memory (§7.1).
2. **Rigid simplicity over configurability.** One fixed status set, one way to
   do things. v2 adds fields and views, **not** knobs.
3. **The owner's nouns, exactly.** Initiative → Product → Repo/Arc → Issue —
   **unchanged in v2** (§3). "Epic" and "project" remain banned words.
4. **Paper-y, calm UI.** Light, typography-led, mobile-friendly.

## 3. The broadened domain (same nouns, wider meaning)

No schema-vocabulary change. The existing nouns simply stretch:

- A **Product** is *any area of responsibility* — a software product, but
  equally "Household", "Finances", "Health". Initiatives still group products.
- **Repo** stays **dev-specific and optional**. v2 makes **repo-less products
  first-class**: an issue needs only a Product (and optionally an Arc); no view
  may treat a missing repo as incomplete, and repo-only affordances (the Git
  section, gitUrl) simply don't appear for products without one.
- An **Arc** is a sub-area or theme inside a Product — for "Household": "Kitchen
  reno", "Yard", "Recurring chores". (Arcs already carry the epic-level "why".)
- An **Issue** is a task. v2 gives it a **Due Date** (§5).

Why keep the nouns: the whole point of Progress is *the owner's* vocabulary, and
the owner already thinks in these. Reusing "Product" for a life-area costs one
small mental stretch; inventing a parallel vocabulary would cost rigid
simplicity and re-open settled schema. (Decision to record at build time.)

## 4. Frictionless structure creation

**User story:** *"I want to create products, arcs, and initiatives both while
I'm creating an issue and on their own from the dashboard."*

Container create/edit/archive already exists (v1, D26) but is reachable mainly
through the command palette. v2 makes structure creation **discoverable and
inline**, so spinning up a new "Household" product or a "Yard" arc is obvious:

1. **Inline in the new-issue flow.** The Initiative / Product / Arc pickers in
   the create-issue dialog each offer a **"+ New …"** affordance that creates
   the container and selects it without leaving the dialog. (This generalizes
   the previously-deferred "add arc from the New Issue modal".)
2. **From the dashboard.** A persistent **"New"** entry point in the app header
   (Issue · Initiative · Product · Repo · Arc), **plus** a **Structure overview**
   route showing the Initiative → Product → Arc tree with an inline **"+ add"**
   on each node — so curating structure is a first-class destination, not a
   palette-only power move.

These reuse the existing optimistic container write paths (D26); v2 adds
*surfaces and inline creation*, not new endpoints. The command palette keeps
working unchanged for those who prefer it.

## 5. Due dates

**User story:** *"For these tasks I need to track a due date."*

- Issues gain an **optional Due Date** — a **calendar date, no time of day**.
- **Timezone-safe by design:** a due date is a *wall-calendar day*, identical
  everywhere — "due July 1" is July 1 regardless of where the app is opened. It
  is therefore an ISO `YYYY-MM-DD` value, **not** an instant. (This differs from
  the existing `createdAt`/`updatedAt` timestamps on purpose; record the
  storage decision at build time.)
- **Editable wherever issues are:** issue-page sidebar field, the new-issue
  dialog, a command-palette picker bound to a single key (proposed `D`), and
  inline in the Agenda/list rows.
- It rides in the **workspace payload** like every other field, so all views
  compute from memory — no new fetch, no spinner.

**Out of scope this phase** (and why): recurring due dates, reminders/digests,
start dates, and date+time. Recurrence is the most likely *next* step — most
household chores repeat — so the field and the Agenda are designed not to
preclude it (§8).

## 6. The Agenda view

**User story:** *"Give me a list of issues ordered by due date, and show each
one's priority with a visual indicator."*

A new dashboard route (proposed `/agenda`):

- Lists **every issue that has a due date**, sorted by due date ascending,
  grouped into **Overdue · Today · This week · Later** (buckets computed from
  the owner's *local* date, since due dates are calendar days). Undated issues
  are **excluded** — they live on the board; the Agenda is purely the
  time-driven cut.
- Each row shows a compact **priority indicator** (§7.2), the issue key, title,
  the due date as a **relative phrase** ("in 3 days", "2 days ago"), and its
  product/arc + status. **Overdue rows are visually distinct.**
- **Filterable** by product, arc, and tag via URL params — exactly the v1 board
  pattern — so "household tasks due this week" is a single bookmark.
- **Cheap inline actions** where they help: mark done, bump the due date.
- **Completed issues never appear** (a done task isn't pending), even if their
  due date is in the past.

## 7. Supporting pieces

### 7.1 It all stays instant (standing constraint)

Due dates ship in the workspace payload; the Agenda and every priority indicator
render from the client store; due-date edits and inline container creation use
the optimistic-mutation template (D21). A spinner on any of these is a bug
(§2.1).

### 7.2 Priority, made visible

A single, reusable **priority indicator** for the fixed urgent/high/medium/low/
none scale — a small color-coded marker (exact visual language chosen at build).
Defined once and used in Agenda rows, with the board and issue lists free to
adopt it. One mapping, no configuration.

## 8. Beyond this phase (direction, not commitment)

- **Recurring tasks** — the natural follow-on for household chores; the due-date
  model and Agenda are built not to block it.
- **Reminders / a daily "what's due" digest.**
- **Start dates** (scheduled-but-not-yet-actionable) and date+time where a task
  is genuinely appointment-like.
- Carry-overs from v1.x: PR-driven status automation, cloud/headless work
  kickoff (archived SPEC §11.2 "Later").

## 9. Open questions

To close into `DECISIONS.md` as they're settled:

1. **Agenda's place in navigation** — a top-level destination alongside the
   board, or a tab within it? *Leaning top-level.*
2. **"This week" definition** — a rolling 7 days, or through the end of the
   current calendar week? *Leaning rolling 7 days.*
3. **Priority indicator visual language** — dot, bars, or flag; which colors?
   *Decide with a quick visual pass at build.*
4. **Structure overview vs. the home dashboard** — a dedicated `/structure`
   route, or fold the tree + "+ add" into the existing home view? *Leaning a
   dedicated route to keep the board uncluttered.*
5. **Due-date storage** — ISO `YYYY-MM-DD` text vs. a normalized integer; the
   §5 timezone-safety requirement is the constraint either way.

## 10. Architecture & data notes

- **One schema change:** add a nullable `due_date` (calendar date) to `issues`,
  via the standard Drizzle migration flow (SETUP §2). It then flows into the
  workspace payload automatically.
- **No new write endpoints** for structure creation — v2 reuses the v1 container
  routes (D26); the work is client surfaces + inline creation.
- **Everything else is client-side:** Agenda bucketing/sorting, the priority
  indicator, and relative-date formatting all run in the store-backed client,
  preserving §2.1.

## 11. Suggested sequence

A rough build order (refine into issues at the next dogfood pass):

1. **Repo-less products first-class** + the **inline / dashboard creation**
   surfaces (§3–§4) — the foundation that makes household use pleasant.
2. **Due-date field** end-to-end (§5): schema → workspace payload → issue page →
   new-issue → palette picker.
3. **Agenda view** + **priority indicator** (§6–§7.2) — the headline of v2.
