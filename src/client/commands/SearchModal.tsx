// The `/` search modal (PROG-130): a search-only surface, separate from the ⌘K
// command palette by design (the palette stays about commands + quick jump).
// Two-wave results that honor the instant-UI rule: title + description hits come
// from the in-memory store and paint immediately; comment hits need a server
// round-trip (D20), so they stream into their own section a beat later and rank
// below the local hits. Matching is case-insensitive substring; ranking weights
// title over description (see ../search).

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { SnapshotPayload } from "../../shared/types";
import {
  containerLabel,
  highlight,
  queryTerms,
  searchContainers,
  searchActions,
  type Segment,
} from "../search";
import { STATUS_LABELS } from "../labels";
import { actionKeyOf, useCommentSearch } from "../store";
import { onOpenSearch } from "./controller";

// One flat, navigable result row. `href` is where Enter/click goes.
type Entry =
  | { kind: "action"; id: string; href: string; key: string; title: string; hint: string }
  | { kind: "container"; id: string; href: string; label: string; hint: string }
  | { kind: "comment"; id: string; href: string; actionKey: string; snippet: string };

const SECTION_TITLES: Record<Entry["kind"], string> = {
  action: "Actions",
  container: "Containers",
  comment: "Comments",
};

export default function SearchModal({ snapshot }: { snapshot: SnapshotPayload }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [, navigate] = useLocation();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(
    () =>
      onOpenSearch((initial) => {
        setQuery(initial ?? "");
        setSelected(0);
        setOpen(true);
      }),
    [],
  );

  // Comment search is the only network half (debounced inside the hook).
  const { data: comments, isFetching } = useCommentSearch(open ? query : "");
  const terms = useMemo(() => queryTerms(query), [query]);

  const entries = useMemo<Entry[]>(() => {
    if (terms.length === 0) return [];
    const actionEntries: Entry[] = searchActions(snapshot, query).map((hit) => ({
      kind: "action",
      id: hit.action.id,
      href: `/action/${actionKeyOf(snapshot, hit.action)}`,
      key: actionKeyOf(snapshot, hit.action),
      title: hit.action.title,
      hint: hit.inTitle
        ? STATUS_LABELS[hit.action.status]
        : `${STATUS_LABELS[hit.action.status]} · in description`,
    }));
    const containerEntries: Entry[] = searchContainers(snapshot, query).map((hit) => ({
      kind: "container",
      id: hit.id,
      href: hit.href,
      label: hit.name,
      hint: containerLabel(hit.kind),
    }));
    // Resolve each comment hit's action from the store (it's already loaded) to
    // build the key for navigation; drop any whose action is somehow missing.
    const commentEntries: Entry[] = (comments?.hits ?? [])
      .map((hit): Entry | null => {
        const action = snapshot.actions.find((i) => i.id === hit.actionId);
        if (!action) return null;
        const key = actionKeyOf(snapshot, action);
        return {
          kind: "comment",
          id: hit.commentId,
          href: `/action/${key}`,
          actionKey: key,
          snippet: hit.snippet,
        };
      })
      .filter((e): e is Entry => e !== null);
    return [...actionEntries, ...containerEntries, ...commentEntries];
  }, [snapshot, query, terms, comments]);

  const sel = Math.min(selected, Math.max(entries.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector("[data-selected]")?.scrollIntoView({ block: "nearest" });
  }, [sel, entries]);

  if (!open) return null;

  const close = () => setOpen(false);
  const go = (entry: Entry) => {
    navigate(entry.href);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(Math.min(sel + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(sel - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = entries[sel];
      if (entry) go(entry);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/20 p-4" onMouseDown={close}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="mx-auto mt-[12vh] max-w-xl overflow-hidden rounded-xl border border-line bg-card shadow-2xl"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder="Search actions, descriptions, comments…"
          className="w-full border-b border-line px-4 py-3 text-sm focus:outline-none"
        />
        <ul ref={listRef} className="max-h-96 overflow-y-auto p-1">
          {entries.map((entry, i) => {
            const prev = entries[i - 1];
            const header = prev?.kind !== entry.kind ? entry.kind : null;
            return (
              <li key={`${entry.kind}:${entry.id}`}>
                {header && (
                  <p className="flex items-center gap-2 px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                    {SECTION_TITLES[header]}
                    {header === "comment" && isFetching && <Spinner />}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => go(entry)}
                  onMouseMove={() => setSelected(i)}
                  data-selected={i === sel || undefined}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm data-selected:bg-line"
                >
                  <ResultLabel entry={entry} terms={terms} />
                </button>
              </li>
            );
          })}

          {/* Comments are still loading and there are no local hits yet. */}
          {entries.length === 0 && terms.length > 0 && isFetching && (
            <li className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-ink-faint">
              <Spinner /> Searching…
            </li>
          )}
          {entries.length === 0 && terms.length > 0 && !isFetching && (
            <li className="px-3 py-6 text-center text-sm text-ink-faint">No matches.</li>
          )}
          {terms.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink-faint">
              Type to search titles, descriptions, and comments.
            </li>
          )}
        </ul>

        {terms.length > 0 && (
          <button
            type="button"
            onClick={() => {
              navigate(`/search?q=${encodeURIComponent(query.trim())}`);
              close();
            }}
            className="block w-full border-t border-line px-4 py-2 text-left text-xs text-ink-faint hover:bg-line/60"
          >
            Open the search page for “{query.trim()}”
            {comments?.truncated && " — more comment matches there"} →
          </button>
        )}
      </div>
    </div>
  );
}

function ResultLabel({ entry, terms }: { entry: Entry; terms: string[] }) {
  if (entry.kind === "comment") {
    return (
      <span className="min-w-0 flex-1">
        <span className="font-mono text-xs text-ink-faint">{entry.actionKey}</span>{" "}
        <span className="text-ink-soft">
          <Highlighted segments={highlight(entry.snippet, terms)} />
        </span>
      </span>
    );
  }
  const text = entry.kind === "action" ? `${entry.key} — ${entry.title}` : entry.label;
  return (
    <>
      <span className="min-w-0 flex-1 truncate">
        <Highlighted segments={highlight(text, terms)} />
      </span>
      <span className="shrink-0 text-xs text-ink-faint">{entry.hint}</span>
    </>
  );
}

function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="rounded bg-adobe-wash px-0.5 text-adobe-deep">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

function Spinner() {
  return (
    <span
      aria-label="loading"
      className="inline-block h-3 w-3 animate-spin rounded-full border border-ink-faint border-t-transparent"
    />
  );
}
