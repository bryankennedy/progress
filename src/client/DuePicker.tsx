// The inline due-date picker (PROG-158): the calendar glyph made editable in
// place, so the outline row can set or bump an action's due date without
// navigating to the action page — the same in-place idea as PriorityPicker
// (PROG-132). A native <input type="date"> stretched invisibly over the glyph
// is the trick; unlike a <select> a date field doesn't pop on a bare click, so
// the overlay calls showPicker() on click (falling back to focus on the older
// Safari that lacks it, matching IconDateInput in fields.tsx). The optimistic
// updateAction re-renders the row instantly.
//
// A set date shows its short label beside the glyph (red once overdue); an
// unset date is glyph-only, left to the caller to reveal on hover the way the
// "none" priority is — the control stays hit-testable while transparent.

import { CalendarGlyph } from "./glyphs";
import { dayDiff, formatDueDate, todayISO } from "./dates";
import { updateAction } from "./store";

export default function DuePicker({
  actionId,
  dueDate,
  // Done rows already read as finished (strikethrough, dimmed) in the outline,
  // so a past due date on one isn't "overdue" — suppress the danger color.
  muted = false,
}: {
  actionId: string;
  dueDate: string | null;
  muted?: boolean;
}) {
  const overdue = !muted && dueDate !== null && dayDiff(todayISO(), dueDate) < 0;
  const tone = overdue ? "text-danger" : dueDate ? "text-ink-soft" : "text-ink-faint";
  return (
    // stopPropagation: dense rows navigate on click elsewhere (the handle,
    // future whole-row targets) — changing the due date must never also open
    // the action or start a drag.
    <span
      onClick={(e) => e.stopPropagation()}
      className={`relative inline-flex items-center gap-1 rounded p-1 -m-1 hover:bg-hover focus-within:bg-hover ${tone}`}
    >
      {/* The input carries the accessible name/value; the glyph and label are
          decoration over it. */}
      <span aria-hidden>
        <CalendarGlyph />
      </span>
      {dueDate && (
        <span aria-hidden className="text-2xs font-medium tabular-nums">
          {formatDueDate(dueDate)}
        </span>
      )}
      <input
        type="date"
        value={dueDate ?? ""}
        onChange={(e) => updateAction(actionId, { dueDate: e.target.value || null })}
        onClick={(e) => {
          // showPicker is the only script API that opens the native calendar
          // and it needs a user gesture; where it's missing (older Safari) the
          // bare focus lets Space/Enter open it. The transparent input already
          // has the click, so no ref juggling.
          try {
            e.currentTarget.showPicker();
          } catch {
            /* focus stays; native indicator is hidden, so nothing else opens it */
          }
        }}
        aria-label={dueDate ? `Due ${dueDate} — change` : "Set due date"}
        title={dueDate ? `Due ${dueDate} — change` : "Set due date"}
        // Fill the glyph/label box, transparent, but hit-testable (the "none"
        // priority relies on the same opacity-0-yet-clickable trick). The
        // native right-edge picker indicator is hidden — the whole control is
        // the target.
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:hidden"
      />
    </span>
  );
}
