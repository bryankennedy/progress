// Minimal toast: only failure feedback for rolled-back optimistic mutations
// needs it (SPEC §8.2 — "failures roll back with a toast"). No dependency,
// module-level store so non-React code (the mutation layer) can raise one.

import { useSyncExternalStore } from "react";

type Toast = { id: number; message: string };

let toasts: readonly Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
  for (const cb of listeners) cb();
}

export function toast(message: string, dismissAfterMs = 5000) {
  const entry = { id: nextId++, message };
  toasts = [...toasts, entry];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t !== entry);
    emit();
  }, dismissAfterMs);
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
          className="rounded-md border border-danger-border bg-danger-bg px-4 py-2 text-sm text-danger shadow-md"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
