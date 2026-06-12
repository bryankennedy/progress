// Tracks "the issue the user is on" for single-key actions (SPEC §4). Two
// sources: the issue page registers its issue while mounted, and on boards
// and lists the card/row under the pointer (or holding keyboard focus) wins
// — tracked by event delegation on the data-issue-id attributes those
// components already render, so no per-component wiring.

import { useEffect } from "react";

let pageIssueId: string | null = null;
let hoverIssueId: string | null = null;

export function currentIssueId(): string | null {
  return hoverIssueId ?? pageIssueId;
}

export function useRegisterPageIssue(id: string | undefined) {
  useEffect(() => {
    pageIssueId = id ?? null;
    return () => {
      pageIssueId = null;
    };
  }, [id]);
}

const issueIdFrom = (target: EventTarget | null) =>
  target instanceof Element
    ? (target.closest("[data-issue-id]")?.getAttribute("data-issue-id") ?? null)
    : null;

let tracking = false;

export function initCurrentIssueTracking() {
  if (tracking) return;
  tracking = true;
  document.addEventListener("mouseover", (e) => {
    hoverIssueId = issueIdFrom(e.target);
  });
  document.addEventListener("focusin", (e) => {
    const id = issueIdFrom(e.target);
    if (id) hoverIssueId = id;
  });
}
