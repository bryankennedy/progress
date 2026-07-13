# PROG-99

### PROG-99 — Mobile container-page rows keep title, indicator, and status select

**Context.** On a phone, the action rows on container pages (workspace / focus /
arc — one shared `ActionRow`) spent nearly the whole row width on the key
column, estimate badge, priority select, and status select, truncating the
title — the row's whole point — to a few characters. The action mandated
preferencing the title and dropping the key; which *other* elements to hide was
left open.

**Decision.** Below the `sm` breakpoint, hide the key link, estimate badge, and
priority `<select>`; keep the title (takes all freed width, still the tap
target into the action), the compact `PriorityIndicator` (14px, priority still
reads at a glance), and the status `<select>` — the row's core inline edit and
the most common on-the-go mutation. Desktop is unchanged; everything returns at
`sm:` and up. Responsive classes only — no second mobile row component to keep
in sync.

**Alternatives rejected.** A two-line mobile layout (title over metadata) keeps
more data visible but doubles row height and diverges the markup for what a
tap-through to the action page already answers. Hiding the status select too
would maximize title width but removes the one inline edit worth doing from a
list on a phone. The Search page's action table was left alone: it already
handles narrow screens with `overflow-x-auto` and a min-width title column.
