// The outline's level bullets (PROG-124/140), extracted from Outline.tsx so the
// row handle, the drag-preview cards, and the capture inputs all draw the same
// glyph from one place (PROG-141). This is deliberately its OWN iconography —
// a Workflowy-style bullet ladder (square → diamond → ring → dot) — distinct
// from the location glyphs in ../glyphs.tsx, which the action page and palette
// use to point AT a container rather than to bullet a row.

// The outline's five levels. One type so the handle, sections, previews, and
// captures can't drift on what a "kind" is.
export type LevelKind = "workspace" | "focus" | "arc" | "action" | "sub";

export function LevelIcon({ kind }: { kind: LevelKind }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  // Workspace sits one level above the focus square (PROG-140): an outlined
  // square enclosing a filled one, reading as "a container that holds focuses".
  if (kind === "workspace")
    return (
      <svg viewBox="0 0 16 16" className={`${cls} text-adobe-deep`} aria-hidden>
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect x="5" y="5" width="6" height="6" rx="1.5" fill="currentColor" />
      </svg>
    );
  if (kind === "focus")
    return (
      <svg viewBox="0 0 16 16" className={`${cls} text-adobe-deep`} fill="currentColor" aria-hidden>
        <rect x="2" y="2" width="12" height="12" rx="2.5" />
      </svg>
    );
  if (kind === "arc")
    return (
      <svg
        viewBox="0 0 16 16"
        className={`${cls} text-moss`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden
      >
        <path d="M8 2.5 14 6 8 9.5 2 6 8 2.5Z" />
        <path d="M2 10l6 3.5L14 10" />
      </svg>
    );
  if (kind === "action")
    return (
      <svg
        viewBox="0 0 16 16"
        className={`${cls} text-ink-faint`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <circle cx="8" cy="8" r="4.5" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className={`${cls} text-ink-faint`} fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  );
}
