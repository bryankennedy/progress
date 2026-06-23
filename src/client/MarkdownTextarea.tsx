// Markdown textarea with image upload (PROG-42): a plain controlled textarea
// plus paste-to-upload and a "+ Image" button. On paste of an image (or a file
// pick), it inserts an `![uploading…]()` placeholder at the caret, uploads to
// R2 via /api/images, then swaps the placeholder for `![alt](/api/images/<id>)`
// — or removes it and toasts on failure. Shared by the description editor
// (EditableMarkdown) and the comment composer (IssuePage).

import { useRef } from "react";
import { toast } from "./toast";
import { IMAGE_MIME, insertAtCursor, uploadImage } from "./uploads";

export default function MarkdownTextarea({
  value,
  onChange,
  className,
  rows,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Async swaps splice into the *current* text, not the snapshot at paste time,
  // so typing or pasting again mid-upload never clobbers an in-flight insert.
  const latest = useRef(value);
  latest.current = value;

  function set(next: string) {
    latest.current = next;
    onChange(next);
  }

  async function handleFiles(files: File[]) {
    const imgs = files.filter((f) => IMAGE_MIME.test(f.type));
    for (const file of imgs) {
      const token = `![uploading ${crypto.randomUUID().slice(0, 8)}…]()`;
      set(insertAtCursor(latest.current, token, ref.current));
      try {
        const { url } = await uploadImage(file);
        const alt = file.name.replace(/\.[^.]+$/, "") || "image";
        set(latest.current.replace(token, `![${alt}](${url})`));
      } catch {
        set(latest.current.replace(token, ""));
        toast("Couldn't upload that image.");
      }
    }
  }

  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.some((f) => IMAGE_MIME.test(f.type))) {
            e.preventDefault();
            void handleFiles(files);
          }
        }}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
      />
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
        <label className="cursor-pointer rounded border border-dashed border-line px-2 py-0.5 hover:border-ink-faint hover:text-ink-soft">
          + Image
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
        <span>or paste an image to upload.</span>
      </div>
    </div>
  );
}
