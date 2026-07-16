// The keyboard map (SPEC §4, exact map decided during build — see D25):
//   ⌘K / Ctrl+K  command palette
//   /            search (PROG-130 — title/description instantly, comments stream)
//   C            create action (container defaults from the current view)
//   S / P / E / L / T  status / priority / estimate / location / tag
//                  (L replaced the pre-PROG-123b M move + A arc pair)
//   D            due date (quick relative options or a typed YYYY-MM-DD)
//   W            work on this (copy bundle as prompt / CLI one-liner)
//                  picker for the current action (action page, or the
//                  hovered/focused card)
// Plain keys are ignored while typing in inputs/textareas/selects.

import { useEffect } from "react";
import { openCreateAction, openPalette, openSearch } from "./controller";
import { currentActionId } from "./currentAction";

const PICKER_KEYS = {
  s: "status",
  p: "priority",
  e: "estimate",
  l: "location",
  t: "tag",
  d: "due",
  w: "workon",
} as const;

export function useGlobalKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette({ kind: "root", actionId: currentActionId() });
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)
      )
        return;
      const key = e.key.toLowerCase();
      if (key === "/") {
        e.preventDefault();
        openSearch();
        return;
      }
      if (key === "c") {
        e.preventDefault();
        openCreateAction();
        return;
      }
      if (key in PICKER_KEYS) {
        const actionId = currentActionId();
        if (!actionId) return;
        e.preventDefault();
        openPalette({ kind: PICKER_KEYS[key as keyof typeof PICKER_KEYS], actionId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
