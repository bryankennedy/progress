// Click-to-edit Markdown block (the "paper-y, open" editing surface, SPEC
// §2): rendered prose that becomes a textarea on click. Shared by issue
// descriptions and container descriptions.
//
// With a `draftScope` (PROG-51), in-progress edits are mirrored to localStorage
// as you type and survive a tab close. Because a restored draft is unsent text
// shown in place of the saved value, reopening into one shows a subtle "unsaved
// draft" indicator so it's never mistaken for what's saved. A failed save keeps
// the draft and offers Retry; a confirmed save clears it.

import { useRef, useState } from "react";
import { clearDraft, readDraft, writeDraft } from "./drafts";
import Markdown from "./Markdown";
import MarkdownTextarea from "./MarkdownTextarea";
import { toastAction } from "./toast";

export default function EditableMarkdown({
  value,
  placeholder,
  onSave,
  draftScope,
}: {
  value: string;
  placeholder: string;
  // Returns whether the server confirmed the save when the caller can report it
  // (so the draft is cleared only on success); a plain void return is treated as
  // success for callers that don't track it.
  onSave: (next: string) => void | Promise<boolean>;
  draftScope?: { meId: string; targetId: string };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // True when the editor opened onto a restored draft that differs from the
  // saved value — drives the "unsaved draft" indicator.
  const [restored, setRestored] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  function beginEdit() {
    const saved = draftScope ? readDraft("description", draftScope.meId, draftScope.targetId) : "";
    if (saved !== "" && saved !== value) {
      setDraft(saved);
      setRestored(true);
    } else {
      setDraft(value);
      setRestored(false);
    }
    setEditing(true);
  }

  function onType(next: string) {
    setDraft(next);
    if (!draftScope) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(
      () => writeDraft("description", draftScope.meId, draftScope.targetId, next),
      400,
    );
  }

  async function persist(next: string) {
    const result = onSave(next);
    const ok = result instanceof Promise ? await result : true;
    if (!draftScope) return;
    if (ok) {
      clearDraft("description", draftScope.meId, draftScope.targetId);
    } else {
      writeDraft("description", draftScope.meId, draftScope.targetId, next);
      toastAction("Couldn't save that description — kept here as a draft.", {
        label: "Retry",
        run: () => void persist(next),
      });
    }
  }

  function save() {
    const next = draft;
    clearTimeout(debounce.current);
    setEditing(false);
    setRestored(false);
    void persist(next);
  }

  function discardDraft() {
    clearTimeout(debounce.current);
    setDraft(value);
    setRestored(false);
    if (draftScope) clearDraft("description", draftScope.meId, draftScope.targetId);
  }

  function cancel() {
    // Explicit abandon: drop this session's edits and the persisted draft.
    clearTimeout(debounce.current);
    setEditing(false);
    setRestored(false);
    if (draftScope) clearDraft("description", draftScope.meId, draftScope.targetId);
  }

  if (editing) {
    return (
      <section>
        {restored && (
          <p className="mb-1 flex items-center gap-2 text-xs text-ink-faint">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-adobe" />
            Unsaved draft restored.
            <button onClick={discardDraft} className="underline hover:text-ink-soft">
              Discard
            </button>
          </p>
        )}
        <MarkdownTextarea
          value={draft}
          onChange={onType}
          rows={8}
          autoFocus
          className="w-full rounded border border-line bg-card p-3 font-mono text-sm"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={save}
            className="rounded bg-adobe px-3 py-1 text-sm text-white hover:bg-adobe-deep"
          >
            Save
          </button>
          <button onClick={cancel} className="rounded px-3 py-1 text-sm text-ink-soft hover:bg-line">
            Cancel
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      onClick={beginEdit}
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
