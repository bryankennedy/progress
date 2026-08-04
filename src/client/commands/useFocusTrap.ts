// Focus containment for the four modal overlays (PROG-146 C4 / PROG-149) —
// palette, search modal, and the two create dialogs. No dependency: a modal
// this small needs exactly two behaviors, so we implement exactly two.
//
//   1. While `active`, Tab/Shift-Tab cycle within the trapped container
//      instead of escaping into the page underneath (aria-modal="true" tells
//      assistive tech the rest is inert; this makes it true for the keyboard).
//   2. On close (deactivate or unmount), focus returns to the element that was
//      focused when the trap engaged — so Esc from the palette puts the
//      keyboard back where ⌘K found it.
//
// Initial focus stays the dialogs' own job (they all autoFocus their input);
// the trap only catches a stray Tab from outside and pulls it to the first
// focusable. Listener rides the capture phase on document so it wins over the
// dialogs' own onKeyDown handlers without needing to touch them.

import { useEffect, useRef } from "react";

// Tabbables we actually render in these dialogs. Elements opted out with
// tabindex="-1" (e.g. listbox option rows — arrow keys own those) are skipped
// by the query and again by the tabIndex re-check for elements that set it via
// property.
const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), " +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const node = ref.current;
      if (!node) return;
      const focusables = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // offsetParent is null for display:none subtrees (a collapsed picker
        // pane's controls must not be tab stops).
        (el) => el.tabIndex !== -1 && el.offsetParent !== null,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const current = document.activeElement;
      if (!(current instanceof HTMLElement) || !node.contains(current)) {
        // Focus drifted (or never entered): pull the keyboard into the dialog.
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore only if the opener still exists — it may have been a board row
      // that re-rendered away.
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [active]);

  return ref;
}
