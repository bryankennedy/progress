// Tracks "the action the user is on" for single-key actions (SPEC §4). Two
// sources: the action page registers its action while mounted, and on boards
// and lists the card/row under the pointer (or holding keyboard focus) wins
// — tracked by event delegation on the data-action-id attributes those
// components already render, so no per-component wiring.

import { useEffect } from "react";

let pageActionId: string | null = null;
let hoverActionId: string | null = null;

export function currentActionId(): string | null {
  return hoverActionId ?? pageActionId;
}

export function useRegisterPageAction(id: string | undefined) {
  useEffect(() => {
    pageActionId = id ?? null;
    return () => {
      pageActionId = null;
    };
  }, [id]);
}

const actionIdFrom = (target: EventTarget | null) =>
  target instanceof Element
    ? (target.closest("[data-action-id]")?.getAttribute("data-action-id") ?? null)
    : null;

let tracking = false;

export function initCurrentActionTracking() {
  if (tracking) return;
  tracking = true;
  document.addEventListener("mouseover", (e) => {
    hoverActionId = actionIdFrom(e.target);
  });
  document.addEventListener("focusin", (e) => {
    const id = actionIdFrom(e.target);
    if (id) hoverActionId = id;
  });
}
