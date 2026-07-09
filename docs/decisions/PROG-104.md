### PROG-104 — Sidebar: switchers to the top, unified field feel, standout Work-on-this

**Status:** accepted (2026-07-09).

**Context.** After PROG-102 removed the Repo container, the action page's right
rail read unevenly: Status/Due/Priority/Estimate had the PROG-101 gutter-icon
treatment (glyph + value in one aligned row), but Focus and Arc were plain
multi-line blocks (value, optional git link, a "Move…/Change…" text button) with
no gutter glyph and their value text left of the boxed fields' text. Tags sat
mid-rail and the "Work on this" agent kickoff was just two more plain text
buttons, easy to miss.

**Decision (owner-directed, feel confirmed via mockups).**

- **Order:** Focus · Arc · Status · Due date · Priority · Estimate · **Work on
  this** · Tags. The two container switchers lead; Tags is last (before the
  created/updated footer).
- **Focus & Arc unified with the boxed fields:** each gets a left gutter glyph
  (a **target** for Focus, a small **arc curve** for Arc) and its value in the
  same text column. The value is `pl-2`-inset so it lines up with the
  select/input text (which sits inside a border + `px-2` gutter). The glyph is a
  button that opens the move/arc palette — the M/A shortcuts still fire, so the
  standalone "Move…/Change…" buttons (and their `(M)`/`(A)` hints) are dropped,
  matching how Status/Priority/Estimate have no separate edit button. The focus
  name and arc name link to their container pages; the focus's optional gitUrl
  stays as a muted second line.
- **Work on this** is lifted out of the plain field rhythm into a **tinted
  action panel** (soft `adobe-wash` background + `adobe-wash` border) so it reads
  as the rail's primary call-to-action. Inside: a filled `adobe` **"Copy as
  prompt → (W)"** button — the app's primary-CTA style (cf. the header **New**
  button) — with a **forward arrow that nudges right on hover**, evoking
  "jumping forward in Progress"; "Copy CLI command" is a subtle secondary link.

Alternatives considered and declined by the owner: a bolder solid-adobe block
(too dominant for the paper-y UI) and a no-box minimal treatment (didn't stand
out enough). Placement at the very top / very bottom was declined in favour of
above-Tags, keeping the metadata fields grouped.

Client-only (`src/client/pages/ActionPage.tsx`); no API/schema change.
