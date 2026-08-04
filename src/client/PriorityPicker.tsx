// The inline priority picker (PROG-132): the PriorityIndicator glyph made
// editable in place, so dense rows (Agenda list, the shared action table) can
// change an action's priority without navigating to the action page. A native
// <select> stretched invisibly over the glyph is the whole trick — click/tap
// pops the platform's own dropdown/wheel (no showPicker gymnastics, works on
// touch), keyboard users tab to it, and the optimistic updateAction makes the
// bars recolor instantly. One component; anywhere the indicator should be
// editable, render this instead of the bare indicator.

import type { ActionPriority } from "../shared/constants";
import { ACTION_PRIORITIES } from "../shared/constants";
import { PRIORITY_LABELS } from "./labels";
import PriorityIndicator from "./PriorityIndicator";
import { updateAction } from "./store";

export default function PriorityPicker({
  actionId,
  priority,
  showLabel = false,
}: {
  actionId: string;
  priority: ActionPriority;
  // Glyph-only for tight rows (Agenda list); glyph + text label for table
  // cells, where the column previously spelled the level out.
  showLabel?: boolean;
}) {
  return (
    // stopPropagation: the picker sits inside rows whose click navigates
    // (ActionTable's whole-row target) — changing priority must never also
    // open the action.
    <span
      onClick={(e) => e.stopPropagation()}
      className="relative inline-flex items-center gap-1.5 rounded p-1 -m-1 hover:bg-hover focus-within:bg-hover"
    >
      {/* The select carries the accessible name/value; the glyph is decor. */}
      <span aria-hidden>
        <PriorityIndicator priority={priority} />
      </span>
      {showLabel && <span>{priority === "none" ? "—" : PRIORITY_LABELS[priority]}</span>}
      <select
        value={priority}
        onChange={(e) => updateAction(actionId, { priority: e.target.value as ActionPriority })}
        aria-label={`Priority: ${PRIORITY_LABELS[priority]} — change`}
        title="Change priority"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {ACTION_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
    </span>
  );
}
