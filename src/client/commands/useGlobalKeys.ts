// The keyboard map (SPEC §4, exact map decided during build — see D25):
//   ⌘K / Ctrl+K  command palette
//   /            search (PROG-130 — title/description instantly, comments stream)
//   C            create issue (container defaults from the current view)
//   S / P / E / M / T / A  status / priority / estimate / move / tag / arc
//   D            due date (quick relative options or a typed YYYY-MM-DD)
//   W            work on this (copy bundle as prompt / CLI one-liner)
//                  picker for the current issue (issue page, or the
//                  hovered/focused card)
// Plain keys are ignored while typing in inputs/textareas/selects.

import { useEffect } from "react";
import { openCreateIssue, openPalette, openSearch } from "./controller";
import { currentIssueId } from "./currentIssue";

const PICKER_KEYS = {
  s: "status",
  p: "priority",
  e: "estimate",
  m: "move",
  t: "tag",
  a: "arc",
  d: "due",
  w: "workon",
} as const;

export function useGlobalKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette({ kind: "root", issueId: currentIssueId() });
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
        openCreateIssue();
        return;
      }
      if (key in PICKER_KEYS) {
        const issueId = currentIssueId();
        if (!issueId) return;
        e.preventDefault();
        openPalette({ kind: PICKER_KEYS[key as keyof typeof PICKER_KEYS], issueId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
