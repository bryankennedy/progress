// Image upload (PROG-42): POST the raw file to the auth-gated /api/images and
// get back a stable `/api/images/<id>` URL to drop into description/comment
// markdown. Kept tiny and framework-free so both the description editor and the
// comment composer can share it via MarkdownTextarea.

export const IMAGE_MIME = /^image\//;

export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`image upload failed: HTTP ${res.status}`);
  return ((await res.json()) as { image: { id: string; url: string } }).image;
}

// Splice `insert` into `value` at the textarea's caret (falls back to appending
// on its own line when there's no live selection).
export function insertAtCursor(
  value: string,
  insert: string,
  ta: HTMLTextAreaElement | null,
): string {
  if (!ta) return value + (value && !value.endsWith("\n") ? "\n" : "") + insert;
  const start = ta.selectionStart ?? value.length;
  const end = ta.selectionEnd ?? value.length;
  return value.slice(0, start) + insert + value.slice(end);
}
