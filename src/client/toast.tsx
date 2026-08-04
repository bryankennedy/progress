// Minimal toast: failure feedback for rolled-back optimistic mutations
// (SPEC §8.2 — "failures roll back with a toast"). No dependency, module-level
// store so non-React code (the mutation layer) can raise one.
//
// PROG-51 adds a sticky variant with an optional action: when a save fails
// after retries, the toast must persist (not vanish in 5s) and offer a Retry
// so the user's preserved draft can be re-sent without hunting for it.
//
// PROG-146 N2 adds `tone`: every toast today is a failure, so the danger
// styling was hard-coded — the first non-error toast (e.g. an undo
// confirmation) would have shipped red with no way to say otherwise. `tone`
// defaults to "danger" so every existing call site is unchanged; "neutral"
// renders with the standard card/ink/line palette instead.

import { useSyncExternalStore } from "react";

export type ToastTone = "danger" | "neutral";
type ToastAction = { label: string; run: () => void };
// `key` (sticky toasts only) dedupes by source: a repeated failure from the same
// composer replaces its toast instead of stacking another identical one.
type Toast = {
  id: number;
  message: string;
  action?: ToastAction;
  sticky: boolean;
  key?: string;
  tone: ToastTone;
};

let toasts: readonly Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
  for (const cb of listeners) cb();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, dismissAfterMs = 5000, tone: ToastTone = "danger") {
  const id = nextId++;
  toasts = [...toasts, { id, message, sticky: false, tone }];
  emit();
  setTimeout(() => dismiss(id), dismissAfterMs);
}

// A persistent toast carrying an action (e.g. Retry). It stays until the user
// invokes the action or dismisses it — used for failed saves where the work is
// recoverable. Running the action dismisses the toast. An optional `key` dedupes
// by source: a fresh failure from the same place replaces its existing toast
// rather than stacking duplicates on a retry-storm.
export function toastAction(
  message: string,
  action: ToastAction,
  key?: string,
  tone: ToastTone = "danger",
) {
  const id = nextId++;
  const wrapped: ToastAction = {
    label: action.label,
    run: () => {
      dismiss(id);
      action.run();
    },
  };
  const rest = key ? toasts.filter((t) => t.key !== key) : toasts;
  toasts = [...rest, { id, message, action: wrapped, sticky: true, key, tone }];
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function Toasts() {
  const current = useSyncExternalStore(subscribe, () => toasts);
  if (current.length === 0) return null;
  // bottom-24 on mobile floats toasts above the fixed bottom tab bar (PROG-79);
  // back to bottom-4 once the bar is gone at sm+.
  return (
    <div className="fixed bottom-24 right-4 z-50 flex flex-col gap-2 sm:bottom-4">
      {current.map((t) => {
        const danger = t.tone === "danger";
        return (
          <div
            key={t.id}
            data-toast
            role="status"
            className={`flex items-center gap-3 rounded-md border px-4 py-2 text-sm shadow-md ${
              danger
                ? "border-danger-border bg-danger-bg text-danger"
                : "border-line bg-card text-ink"
            }`}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                onClick={t.action.run}
                className={`rounded border px-2 py-0.5 text-xs font-medium ${
                  danger
                    ? "border-danger-border hover:bg-danger-border/20"
                    : "border-line hover:bg-hover"
                }`}
              >
                {t.action.label}
              </button>
            )}
            {t.sticky && (
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className={
                  danger ? "text-danger/60 hover:text-danger" : "text-ink-faint hover:text-ink"
                }
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
