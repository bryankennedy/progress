// Minimal toast: failure feedback for rolled-back optimistic mutations
// (SPEC §8.2 — "failures roll back with a toast"). No dependency, module-level
// store so non-React code (the mutation layer) can raise one.
//
// PROG-51 adds a sticky variant with an optional action: when a save fails
// after retries, the toast must persist (not vanish in 5s) and offer a Retry
// so the user's preserved draft can be re-sent without hunting for it.

import { useSyncExternalStore } from "react";

type ToastAction = { label: string; run: () => void };
type Toast = { id: number; message: string; action?: ToastAction; sticky: boolean };

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

export function toast(message: string, dismissAfterMs = 5000) {
  const id = nextId++;
  toasts = [...toasts, { id, message, sticky: false }];
  emit();
  setTimeout(() => dismiss(id), dismissAfterMs);
}

// A persistent toast carrying an action (e.g. Retry). It stays until the user
// invokes the action or dismisses it — used for failed saves where the work is
// recoverable. Running the action dismisses the toast.
export function toastAction(message: string, action: ToastAction) {
  const id = nextId++;
  const wrapped: ToastAction = {
    label: action.label,
    run: () => {
      dismiss(id);
      action.run();
    },
  };
  toasts = [...toasts, { id, message, action: wrapped, sticky: true }];
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function Toasts() {
  const current = useSyncExternalStore(subscribe, () => toasts);
  if (current.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {current.map((t) => (
        <div
          key={t.id}
          data-toast
          className="flex items-center gap-3 rounded-md border border-danger-border bg-danger-bg px-4 py-2 text-sm text-danger shadow-md"
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              onClick={t.action.run}
              className="rounded border border-danger-border px-2 py-0.5 text-xs font-medium hover:bg-danger-border/20"
            >
              {t.action.label}
            </button>
          )}
          {t.sticky && (
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="text-danger/60 hover:text-danger"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
