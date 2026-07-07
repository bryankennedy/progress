### PROG-89 — Agenda quick-add captures into the date bucket it's typed under

Each Agenda grouping except Overdue ends in a quick-add input: type a title,
Enter, and an issue is created already carrying the bucket's due date, so it
lands (optimistically, instantly) in the group it was typed under. *Decisions
within, per owner answers on the issue:* (1) **Due dates are the rolling
window's edges** — Today → today, This week → today+6 (the last day of D38's
rolling window, "by end of week"), Later → today+7 (the first day beyond it) —
chosen over calendar-week Sundays (which can disagree with the rolling
buckets) and soft midpoints; every minted date provably lands back in its own
bucket (unit-tested). (2) **The product comes from an inline picker with a
smart default**: it follows the active Product filter when set, otherwise the
last product quick-added into (localStorage, fail-soft) — the Agenda is
cross-product, so the target can't be inferred from context alone. An active
Arc filter is inherited when it belongs to the chosen product. (3) **No input
under Overdue** — an issue can't be born already late; Overdue stays
triage-only. (4) **Empty groups keep hiding** (owner's explicit pick over
always-showing capturable groups): the input renders only under groups that
already have issues. (5) Quick-adds are created **`todo`, priority none** — a
dated capture is committed work, not backlog. Date math in
`src/client/agendaQuickAdd.ts` (unit-tested); wiring covered by
`e2e/agenda-quickadd.spec.ts`.
