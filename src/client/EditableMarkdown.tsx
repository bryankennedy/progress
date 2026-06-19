// Click-to-edit Markdown block (the "paper-y, open" editing surface, SPEC
// §2): rendered prose that becomes a textarea on click. Shared by issue
// descriptions and container descriptions.

import { useState } from "react";
import Markdown from "react-markdown";

export default function EditableMarkdown({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing) {
    return (
      <section>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          autoFocus
          className="w-full rounded border border-line bg-card p-3 font-mono text-sm"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
            className="rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded px-3 py-1 text-sm text-ink-soft hover:bg-line"
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className="group -m-1 cursor-text rounded p-1 hover:bg-card"
    >
      {value === "" ? (
        <p className="text-ink-faint">{placeholder}</p>
      ) : (
        <div className="prose-lite">
          <Markdown>{value}</Markdown>
        </div>
      )}
    </section>
  );
}
