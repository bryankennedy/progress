// Container-level glyphs, shared by the action page's Location field and the
// palette's location picker so the two surfaces carry one iconography
// (PROG-123). Focus and Arc began life as ActionPage gutter glyphs
// (PROG-104); all three share the 16×16 box and currentColor, so callers set
// size context via text color only.

// Workspace glyph: a 2×2 portfolio grid — the workspace holds focuses side by
// side rather than pointing at any one of them.
export function WorkspaceGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="inline-block h-3.5 w-3.5 shrink-0">
      <rect x="2.5" y="2.5" width="4.75" height="4.75" rx="1.2" fill="currentColor" />
      <rect x="8.75" y="2.5" width="4.75" height="4.75" rx="1.2" fill="currentColor" />
      <rect x="2.5" y="8.75" width="4.75" height="4.75" rx="1.2" fill="currentColor" />
      <rect x="8.75" y="8.75" width="4.75" height="4.75" rx="1.2" fill="currentColor" />
    </svg>
  );
}

// Focus glyph (PROG-104): a target/crosshair — the focus is the thing the
// action is "focused" on.
export function FocusGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="inline-block h-3.5 w-3.5 shrink-0">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2.25" fill="currentColor" />
    </svg>
  );
}

// Downward chevron (PROG-148, audit N1): the disclosure marker for the header
// New menu, the mobile Filters toggle, the outline's arc menu, … Replaces the
// old `▾` text glyph, which rendered in Spectral and varied by platform. Same
// currentColor line idiom as the nav icons; callers size via className (the
// default matches the 16×16 glyph family) and rotate it for the open state.
export function ChevronDownGlyph({ className = "h-3.5 w-3.5 shrink-0" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.25 8 10l4-3.75" />
    </svg>
  );
}

// Arc glyph (PROG-104): a rainbow-like arc between two endpoints — the
// milestone trajectory an arc groups actions along.
export function ArcGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="inline-block h-3.5 w-3.5 shrink-0">
      <path
        d="M2.75 11.5 A 5.25 5.25 0 0 1 13.25 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="2.75" cy="11.5" r="1.4" fill="currentColor" />
      <circle cx="13.25" cy="11.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

// Check glyph (PROG-150): the "selected" marker in the Header theme picker.
// Same currentColor line idiom as ChevronDownGlyph (audit N1) rather than a
// text "✓" glyph.
export function CheckGlyph({ className = "h-3.5 w-3.5 shrink-0" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}
