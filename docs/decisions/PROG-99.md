### PROG-99 — Mobile arc list: name over key

**Decision.** On the arc/focus/workspace action list (`ContainerPage`'s
`ActionRow`), below the `sm` breakpoint, hide the action **key** and replace the
two inline priority/status `<select>`s with the compact read-only
`PriorityIndicator` / `StatusIndicator` glyphs. The title keeps `flex-1` and
reclaims the row. At `sm+` the row is unchanged (key + inline editors).

**Why.** The row packed key (`w-20`), title, and two selects into one flex line.
On a phone the fixed-width key and the two selects consumed the width and the
`flex-1` title truncated to nothing — the single most important field, the name,
was invisible. Per the action: preference the name, drop the key ("not
important"), hide other items as needed. The key stays one tap away on the
action page; priority/status remain glanceable as glyphs (both encode meaning in
shape *and* color, so they survive the shrink), and inline editing on mobile
moves to the action page.

**Scope — why only the arc list.** The report and screenshot are the arc view.
The **Agenda** row already stacks the title on its own full-width line (title is
never the loser there), and **Search** is a deliberate multi-column desktop data
table — a different layout problem, not a squeezed flex row. Both are left
untouched; if the Agenda key or the Search table later want a mobile pass, that's
a separate action, not this one.
