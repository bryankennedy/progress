// Settle-on-drop for every DragOverlay surface (PROG-118 polish; board +
// outline): the default drop tween glides the floating card from the release
// point into its final slot while the shadow eases off, and keeps the in-list
// source ghosted until it lands. Safe now that PROG-119 made optimistic writes
// notify synchronously — by the time the overlay measures its destination the
// row/card has ALREADY re-rendered at the drop position. (Pre-PROG-119 the
// measurement hit the stale slot and the card flew back to it, which is why
// the board and the old outline section overlays used dropAnimation={null} —
// PROG-43.)
import { defaultDropAnimationSideEffects, type DropAnimation } from "@dnd-kit/core";

export const DROP_ANIMATION: DropAnimation = {
  duration: 180,
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.3" } } }),
};
