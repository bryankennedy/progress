// Admin — sign-in allowlist management (D43). Super-admins (defined by the
// SUPER_ADMIN_EMAILS secret) curate who else may use the app; the list lives in
// D1 and is edited here through the existing optimistic store flow
// (addAllowedEmail / updateAllowedEmailNote / removeAllowedEmail). The route is
// reachable by anyone, so the page itself re-checks `isSuperAdmin` — but the
// real boundary is the API, which gates every /api/admin/* route server-side.

import { useState } from "react";
import { Link } from "wouter";
import type { WireAllowedEmail, WorkspacePayload } from "../../shared/types";
import { addAllowedEmail, removeAllowedEmail, updateAllowedEmailNote } from "../store";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function Admin({ workspace }: { workspace: WorkspacePayload }) {
  if (!workspace.isSuperAdmin) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-2 text-sm text-ink-soft">
          This page is for administrators only.{" "}
          <Link href="/" className="text-adobe hover:underline">
            Back to the workspace
          </Link>
        </p>
      </div>
    );
  }

  const list = workspace.allowedEmails;

  return (
    <div className="mx-auto max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin · Access</h1>
        <p className="mt-1 text-xs text-ink-faint">
          Who may sign in to Progress. Super-admins (the <code>SUPER_ADMIN_EMAILS</code> secret)
          always have access and manage this list — they aren&apos;t shown here.
        </p>
      </div>

      <AddForm existing={list} />

      <div className="mt-6 overflow-hidden rounded-lg border border-line bg-card">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-3 border-b border-line px-4 py-2 text-[10px] uppercase tracking-wide font-mono text-ink-faint">
          <span>Email</span>
          <span>Note</span>
          <span>Added</span>
        </div>
        {list.length === 0 && (
          <p className="px-4 py-4 text-sm text-ink-faint">
            No one is on the allowlist yet. Add an email above to grant access.
          </p>
        )}
        {list.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function AddForm({ existing }: { existing: WireAllowedEmail[] }) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  const trimmed = email.trim().toLowerCase();
  const dup = trimmed !== "" && existing.some((e) => e.email === trimmed);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && !dup;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    addAllowedEmail(email, note);
    setEmail("");
    setNote("");
  }

  return (
    <form onSubmit={submit} className="mt-5 flex flex-wrap items-center gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@example.com"
        className="min-w-56 flex-1 rounded border border-line px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="min-w-48 flex-1 rounded border border-line px-3 py-2 text-sm focus:border-ink-faint focus:outline-none"
      />
      <button
        type="submit"
        disabled={!valid}
        className="rounded bg-adobe px-4 py-2 text-sm font-medium text-white hover:bg-adobe-deep disabled:cursor-not-allowed disabled:opacity-40"
      >
        Add
      </button>
      {dup && <span className="w-full text-xs text-danger">That email is already on the list.</span>}
    </form>
  );
}

function Row({ row }: { row: WireAllowedEmail }) {
  const [note, setNote] = useState(row.note);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0">
      <span className="truncate font-mono text-[13px] text-ink" title={row.email}>
        {row.email}
      </span>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note.trim() !== row.note && updateAllowedEmailNote(row.id, note)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder="Add a note…"
        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-ink-soft hover:border-line focus:border-ink-faint focus:bg-paper focus:outline-none"
      />
      <div className="flex items-center gap-3 justify-self-end">
        <span className="whitespace-nowrap text-xs text-ink-faint" title={row.addedByEmail || undefined}>
          {formatDate(row.createdAt)}
        </span>
        {confirming ? (
          <span className="flex items-center gap-1 text-xs">
            <button
              onClick={() => removeAllowedEmail(row.id)}
              className="rounded px-1.5 py-0.5 font-medium text-danger hover:bg-danger/10"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded px-1.5 py-0.5 text-ink-faint hover:bg-line"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded px-1.5 py-0.5 text-xs text-ink-faint hover:bg-line hover:text-danger"
            aria-label={`Remove ${row.email}`}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
