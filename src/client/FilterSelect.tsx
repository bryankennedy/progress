// The filter dropdown shared by the board (Home) and the search page (PROG-76):
// a labelled <select> whose first option clears the filter ("{label}: all").
// Both surfaces filter the same dimensions, so they share one control.

import { FILTER_NONE } from "./boardFilters";

export default function FilterSelect({
  label,
  value,
  options,
  onChange,
  nullable = false,
}: {
  label: string;
  value: string | undefined;
  options: [string, string][];
  onChange: (value: string | null) => void;
  // Nullable fields (Arc, Repo, Tag) offer a "none" option to find actions with
  // no value there (PROG-76). Required fields (Focus) and global vocabularies
  // (Priority, Status) leave it off.
  nullable?: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      // The first option already carries the label as its visible text
      // ("Focus: all"), but once a value is picked the select shows only that
      // option's bare name — aria-label keeps "what field is this" available
      // to assistive tech regardless of selection (PROG-149 semantic sweep).
      aria-label={label}
      // A set filter reads from across the room (PROG-146 CR3): the active
      // state borrows the nav's accent-wash treatment instead of a bg-line
      // shift that was 1.28:1 away from the resting card.
      className={`rounded border px-2 py-1 text-xs ${
        value
          ? "border-accent bg-accent-wash/40 text-accent-deep"
          : "border-line bg-card text-ink-soft"
      }`}
    >
      <option value="">{label}: all</option>
      {nullable && <option value={FILTER_NONE}>{label}: none</option>}
      {options.map(([v, name]) => (
        <option key={v} value={v}>
          {name}
        </option>
      ))}
    </select>
  );
}
