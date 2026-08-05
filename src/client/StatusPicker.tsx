// The inline status picker (PROG-140): the StatusIndicator glyph made
// editable in place, mirroring the priority picker (PROG-132) exactly — a
// native <select> stretched invisibly over the glyph. Click/tap pops the
// platform's own dropdown/wheel (no showPicker gymnastics, works on touch),
// keyboard users tab to it, and the optimistic updateAction recolors/reshapes
// the glyph instantly. One component; anywhere the status indicator should be
// editable, render this instead of the bare indicator.

import type { ActionStatus } from "../shared/constants";
import { ACTION_STATUSES } from "../shared/constants";
import { STATUS_LABELS } from "./labels";
import StatusIndicator from "./StatusIndicator";
import { updateAction } from "./store";

export default function StatusPicker({
  actionId,
  status,
  showLabel = false,
}: {
  actionId: string;
  status: ActionStatus;
  // Glyph-only for tight rows (outline); glyph + text label for table
  // cells, where the column previously spelled the status out.
  showLabel?: boolean;
}) {
  return (
    // stopPropagation: the picker sits inside rows whose click navigates
    // (ActionTable's whole-row target) — changing status must never also
    // open the action.
    <span
      onClick={(e) => e.stopPropagation()}
      className="relative inline-flex items-center gap-1.5 rounded p-1 -m-1 hover:bg-hover focus-within:bg-hover"
    >
      {/* The select carries the accessible name/value; the glyph is decor. */}
      <span aria-hidden>
        <StatusIndicator status={status} />
      </span>
      {showLabel && <span>{STATUS_LABELS[status]}</span>}
      <select
        value={status}
        onChange={(e) => updateAction(actionId, { status: e.target.value as ActionStatus })}
        aria-label={`Status: ${STATUS_LABELS[status]} — change`}
        title="Change status"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {ACTION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </span>
  );
}
