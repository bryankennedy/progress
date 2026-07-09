// PROG-100: one shared "closed" visual treatment for an action wherever it
// shows up in a list. A closed action — done (shipped) or canceled (abandoned)
// — reads as finished: its title dims and gets a strikethrough, so the text is
// still legible but plainly complete at a glance. Both terminal statuses share
// the exact same look (a canceled action is as inactive as a done one), which
// is what the owner asked for.
//
// The treatment itself is the outline's original done styling (PROG-77), lifted
// out of Outline.tsx so every list — container/arc pages, search, the outline —
// renders completion identically instead of each re-deriving the classes. Kept
// as a class helper rather than a wrapper component because the title is
// rendered inside wildly different elements across the app (a plain <Link>, a
// highlighted-segment span, an editable <input>); a shared className composes
// with all of them, a shared component with none.

import { isOpenStatus, type ActionStatus } from "../shared/constants";

// Tailwind classes applied to a closed action's TITLE text. Dim + strike.
export const CLOSED_TITLE_CLASS = "text-ink-faint line-through";

// The title class for an action of the given status: the closed treatment when
// terminal, an empty string when still open. Empty (not undefined) so callers
// can unconditionally interpolate it into a className template.
export function closedTitleClass(status: ActionStatus): string {
  return isOpenStatus(status) ? "" : CLOSED_TITLE_CLASS;
}
