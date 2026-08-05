// Click-to-edit single-line text, used for action titles, container names,
// key prefixes, and git URLs. Enter commits, Escape or blur cancels — a blur
// never saves, so a stray click can't half-commit an edit.

import { useState } from "react";

export default function InlineEdit({
  value,
  onSave,
  className = "",
  inputClassName = "",
  placeholder = "—",
  validate,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  // Optional gate: return false to keep the editor open (e.g. empty name).
  validate?: (next: string) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Click to edit"
        className={`cursor-text rounded text-left hover:bg-hover/40 ${className} ${value === "" ? "text-ink-faint" : ""}`}
      >
        {value === "" ? placeholder : value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEditing(false);
        if (e.key === "Enter") {
          const next = draft.trim();
          if (validate && !validate(next)) return;
          if (next !== value) onSave(next);
          setEditing(false);
        }
      }}
      // bg-paper (PROG-151): every InlineEdit site now sits inside a bg-card
      // content well (the action/container page header), so the editing
      // input recesses against paper rather than vanishing on matching card.
      className={`w-full rounded border border-line bg-paper px-1 ${inputClassName}`}
    />
  );
}
