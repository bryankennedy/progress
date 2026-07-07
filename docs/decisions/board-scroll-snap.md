### Board columns scroll-snap to a "home" on mobile

On a phone the board columns hit their `min-w-72` floor and the row scrolls
horizontally; a swipe used to rest anywhere, leaving you looking at two column
halves. Made the scroll **detent**: the row is `snap-x snap-mandatory` and each
column is a `snap-start` point, so a horizontal swipe always settles with one
column pinned to the left edge — each column becomes a "home" for the scroll.
*Decisions within:* (1) **snap-start, not center** — a left-to-right board reads
like flipping pages, next column peeking in on the right; centering would split
the peek across both edges. (2) **mandatory, not proximity** — the ask was a
firm home for every scroll, and horizontal mandatory snap has none of the
vertical-content trap that makes mandatory risky elsewhere. (3) **No width
change** — kept the existing `min-w-72` column width (the owner chose "keep
current"); snapping is purely additive. (4) **Suppressed mid-drag** — the class
is gated on `activeId`, because the card-drag edge auto-scroll (PROG-47/48)
scrolls this same row programmatically and mandatory snap fights it, re-snapping
after each step and stuttering the auto-scroll toward the target column; on drop
`activeId` clears and the row re-snaps to the nearest column. (5) **Desktop
untouched** — `flex-1` fits every column there, so the row never overflows and
snap is inert. Verified in WebKit at 390 px: a partial nudge settled exactly on
a column edge (0 px delta), zero page overflow.
