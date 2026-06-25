// Local draft persistence (PROG-51): unsent text — a comment being composed or
// an in-progress description edit — is mirrored to localStorage as you type, so
// it survives a tab close, reload, accidental navigation, or a failed save. The
// draft is the safety net; it's cleared only once the write is confirmed
// server-side.
//
// Keys are namespaced by the signed-in user (`me.id`) so drafts can't leak
// across allowlisted accounts that share a browser profile (the single-tenant
// trust model still treats every account as trusted, but unsent text is
// per-author by nature). These are plain functions; components own the debounce
// and the field state, and the store's reconcile path clears on success.

type DraftKind = "comment" | "description";

function storageKey(kind: DraftKind, meId: string, targetId: string): string {
  return `progress:draft:${kind}:${meId}:${targetId}`;
}

export function readDraft(kind: DraftKind, meId: string, targetId: string): string {
  // localStorage can throw (private-mode quotas, disabled storage). A lost draft
  // is a degraded experience, never a crash — so every access is guarded.
  try {
    return localStorage.getItem(storageKey(kind, meId, targetId)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(kind: DraftKind, meId: string, targetId: string, value: string): void {
  const key = storageKey(kind, meId, targetId);
  try {
    // An empty draft is the absence of a draft — don't leave a stale "" behind.
    if (value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Best-effort: a write that can't persist just means no recovery later.
  }
}

export function clearDraft(kind: DraftKind, meId: string, targetId: string): void {
  writeDraft(kind, meId, targetId, "");
}
