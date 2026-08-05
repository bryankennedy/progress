// The one page-header grammar (PROG-148): every route opens with the same
// `<h1>` row, so the "where am I" anchor sits in the same place on every page.
// The audit (PROG-146 S6) found five pages carrying hand-rolled variants of
// this row while the two most-visited pages (Board, Search) had no h1 at all —
// their heading order started at h2. One component, four slots:
//
//   title    — the h1 text. Canonical style is text-2xl font-semibold with
//              normal tracking: tracking-tight is a grotesque-sans convention,
//              and Spectral's fitted sidebearings clot at 2xl (PROG-146 CR6).
//   meta     — the small count/status line beside the title (Board's action
//              count, Agenda's dated count, Diary's completed/started).
//   actions  — a right-aligned control cluster (Outline's Hide-done + Scope,
//              Agenda's List/Table toggle, Archive's back link).
//   below    — a full-width block under the title row (Outline's capture hint,
//              Admin's description).
//
// The container/action pages deliberately do NOT render this component: their
// header is the breadcrumb + inline-editable entity title, a different (and
// reasoned) grammar — they just share the same h1 classes and vertical rhythm.

export default function PageHeader({
  title,
  meta,
  actions,
  below,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {meta && <p className="text-xs text-ink-faint">{meta}</p>}
      {/* flex-wrap + min-w-0 (PROG-147): on a 320px phone a wide control
          cluster (e.g. Outline's Hide-done + Scope select) wraps to its own
          line and can break again inside it, instead of overflowing the page. */}
      {actions && (
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{actions}</div>
      )}
      {below && <div className="w-full">{below}</div>}
    </header>
  );
}
