// Settle-on-drop for every DragOverlay surface (PROG-118 polish; board +
// outline): the default drop tween glides the floating card from the release
// point into its final slot while the shadow eases off, and keeps the in-list
// source ghosted until it lands. Safe now that PROG-119 made optimistic writes
// notify synchronously — by the time the overlay measures its destination the
// row/card has ALREADY re-rendered at the drop position. (Pre-PROG-119 the
// measurement hit the stale slot and the card flew back to it, which is why
// the board and the old outline section overlays used dropAnimation={null} —
// PROG-43.)
//
// prefers-reduced-motion (CR4/PROG-149): this tween is a JS-driven Web
// Animations call (dnd-kit's own settle, not a CSS transition), so the global
// `@media (prefers-reduced-motion: reduce)` rule in styles.css can't reach it —
// zero the duration directly. Read once at module load: the media query can't
// change without a reload-triggering OS/browser settings change, so no need to
// re-check per drop.
import { defaultDropAnimationSideEffects, type DropAnimation } from "@dnd-kit/core";

const reducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const DROP_ANIMATION: DropAnimation = {
  duration: reducedMotion ? 0 : 180,
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.3" } } }),
};
