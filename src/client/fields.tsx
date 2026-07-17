// The sidebar field primitives (PROG-101/PROG-104), extracted from ActionPage
// so the create-action dialog renders the same labeled, icon-guttered fields
// as the action page (PROG-117): a mono uppercase label above, a glyph button
// in a shared left gutter, and the control filling the text column.

import { useRef } from "react";

// The field-edit triggers below a field's value (Move… / Change… / Edit…).
// They carry keyboard shortcuts on desktop, but on a phone tapping the link is
// the ONLY way to fire them — so give each a 44px-tall touch row on mobile
// while keeping the compact one-line-each layout on desktop (PROG-81). `flex`
// is block-level, so each still sits on its own line as `block` did.
export const FIELD_ACTION_CLS =
  "flex min-h-11 items-center text-xs text-adobe hover:underline sm:block sm:min-h-0";

// Every gutter glyph is a button (PROG-101b): slight padding for a bigger hit
// target, a hover wash for affordance.
export const GLYPH_BUTTON_CLS = "-m-1 flex rounded p-1 hover:bg-line";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide font-mono text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}

// The shared icon gutter for editable fields (PROG-101): glyph on the left,
// control filling the rest, so the rows align vertically.
export function IconRow({
  icon,
  children,
  align = "center",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div className={`flex gap-2 ${align === "start" ? "items-start" : "items-center"}`}>
      {/* start: the glyph anchors to the first content line instead of the
          stack's middle (the Location tree, PROG-123) — the 3px nudge centers
          the 14px glyph on the 20px text-sm line box. */}
      {align === "start" ? <div className="pt-[3px]">{icon}</div> : icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// A FieldSelect whose gutter glyph doubles as a picker button (PROG-101b):
// clicking the glyph pops the select's dropdown, mirroring the due-date
// calendar button, so the icon column is uniformly actionable.
// Optional children render below the select in the same control column, so
// extra controls (the status panel's buttons) share the select's left edge
// while IconRow's items-center centers the glyph against the full stack
// (PROG-110).
export function IconSelect({
  icon,
  openLabel,
  value,
  options,
  onChange,
  children,
}: {
  icon: React.ReactNode;
  openLabel: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  return (
    <IconRow
      icon={
        <button
          type="button"
          aria-label={openLabel}
          onClick={() => {
            // showPicker is the only script API that pops a native select
            // open; where it's missing (older Safari) fall back to focusing —
            // Space/Enter then opens it.
            try {
              ref.current?.showPicker();
            } catch {
              ref.current?.focus();
            }
          }}
          className={GLYPH_BUTTON_CLS}
        >
          {icon}
        </button>
      }
    >
      <FieldSelect ref={ref} value={value} options={options} onChange={onChange} />
      {children}
    </IconRow>
  );
}

export function FieldSelect({
  value,
  options,
  onChange,
  ref,
}: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  // React 19 ref-as-prop; IconSelect uses it to pop the dropdown open.
  ref?: React.Ref<HTMLSelectElement>;
}) {
  return (
    <select
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-line bg-card px-2 py-1 text-sm hover:border-ink-faint"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

// The due-date field's whole control (PROG-101, shared by PROG-117): calendar
// glyph in the gutter opening the native picker, date input in the column.
// `value`/`onChange` speak the empty string for "unset" — callers map null.
export function IconDateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <IconRow
      icon={
        <button
          type="button"
          aria-label="Open calendar"
          onClick={() => {
            // The calendar button, moved from the input's right edge (native
            // indicator, hidden below) into the shared left gutter. showPicker
            // needs a user gesture and is missing on older Safari — fall back
            // to focusing the input.
            try {
              ref.current?.showPicker();
            } catch {
              ref.current?.focus();
            }
          }}
          className={`${GLYPH_BUTTON_CLS} text-ink-faint hover:text-ink-soft`}
        >
          <CalendarGlyph />
        </button>
      }
    >
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // w-full + min-w-0 + max-w-full: pin the native date control to
        // the column width instead of letting its (wide, on iOS Safari)
        // intrinsic size win. iOS renders a localized label ("Jun 30, 2026")
        // wider than the Android/Chrome "06/30/2026", and its intrinsic
        // min-width can push past the viewport even with min-w-0. The
        // explicit max-w-full + box-border ensures the border-box never
        // exceeds the parent, and the [&::-webkit-date-and-time-value]
        // override left-aligns the text (Safari centers it by default,
        // burning horizontal space on both sides). The native
        // right-edge picker indicator hides because the gutter button
        // replaces it (PROG-101).
        className="w-full min-w-0 max-w-full box-border rounded border border-line bg-card px-2 py-1 text-sm hover:border-ink-faint [&::-webkit-date-and-time-value]:text-left [&::-webkit-calendar-picker-indicator]:hidden"
      />
    </IconRow>
  );
}

// The due-date field's calendar glyph — same 16×16 box and size as the
// indicator glyphs so the gutter column lines up.
function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="inline-block h-3.5 w-3.5 shrink-0">
      <rect
        x="2"
        y="3"
        width="12"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M2.75 6.5 H13.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.25 1.75 V4 M10.75 1.75 V4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="5.5" cy="9.5" r="1" fill="currentColor" />
      <circle cx="8" cy="9.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="9.5" r="1" fill="currentColor" />
    </svg>
  );
}
