// "Work on this" (SPEC §11.2, PROG-19): hand an action's context bundle to a
// Claude Code session. In-app we offer two clipboard actions — copy the bundle
// Markdown as a prompt (the §11.1 "copy as prompt" button), or copy the
// `progress work <KEY>` CLI one-liner that fetches the bundle and launches
// `claude` in the right checkout (bin/progress.ts, see SETUP §7).
//
// The bundle comes from GET /api/actions/:key/bundle (text/markdown). It's
// cached and prefetched on action load so the copy is instant — no interaction
// spinner (SPEC §8.2).

import { toast } from "./toast";

// The bundle is rendered server-side from the action's current state (fields,
// comments, tags, lineage). We cache it so a copy is instant — but the cache
// goes stale the moment the action changes, so the store re-warms it via
// `prefetchBundle` after every mutation (see store.ts). A copy always prefers
// an in-flight refresh over the cached value, so a copy right after an edit
// still gets the latest.
// Cache keys are namespaced by surface (`action:KEY`, `arc:ID`) so the action and
// arc work orders never collide. Each entry remembers the URL it fetches from.
const bundleCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const actionBundle = (key: string) => ({
  cacheKey: `action:${key}`,
  url: `/api/actions/${key}/bundle`,
});
const arcBundle = (arcId: string) => ({
  cacheKey: `arc:${arcId}`,
  url: `/api/arcs/${arcId}/bundle`,
});

async function fetchBundle(cacheKey: string, url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bundle fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  bundleCache.set(cacheKey, text);
  return text;
}

// `force` skips the cache (used by prefetch to refresh after a change). An
// in-flight fetch is always preferred — it's the freshest — and is shared so a
// burst of changes coalesces into one request.
function loadBundle(cacheKey: string, url: string, force: boolean): Promise<string> {
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  if (!force) {
    const cached = bundleCache.get(cacheKey);
    if (cached !== undefined) return Promise.resolve(cached);
  }
  const p = fetchBundle(cacheKey, url).finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, p);
  return p;
}

// Warm (or refresh) the cache so a later click copies instantly (and within
// the clipboard's user-activation window). Called on action-page mount and by
// the store after any mutation to the action, so the cached bundle never goes
// stale.
export function prefetchBundle(key: string): void {
  const { cacheKey, url } = actionBundle(key);
  void loadBundle(cacheKey, url, true).catch(() => {
    /* a failed prefetch just means the copy action fetches on demand */
  });
}

// Arc work order spans many actions, so it's heavier to render — prefetch on
// arc-page mount keeps the copy click instant, same as the action surface.
export function prefetchArcBundle(arcId: string): void {
  const { cacheKey, url } = arcBundle(arcId);
  void loadBundle(cacheKey, url, true).catch(() => {
    /* a failed prefetch just means the copy action fetches on demand */
  });
}

async function copy(text: string, ok: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast("Clipboard is blocked — copy it manually.");
  }
}

// The CLI one-liner: bin/progress.ts exposed as `progress` (see SETUP §7).
export const workCommand = (key: string): string => `progress work ${key}`;

export async function copyBundleAsPrompt(key: string): Promise<void> {
  const { cacheKey, url } = actionBundle(key);
  let bundle: string;
  try {
    // Prefers an in-flight refresh, so a copy right after an edit/comment gets
    // the latest rather than a stale cached bundle.
    bundle = await loadBundle(cacheKey, url, false);
  } catch {
    toast("Couldn't fetch the action bundle.");
    return;
  }
  await copy(bundle, `Copied ${key} as a prompt.`);
}

// The arc analogue: copy a single prompt covering every open action in the arc.
// `label` is the arc name, just for the confirmation toast.
export async function copyArcBundleAsPrompt(arcId: string, label: string): Promise<void> {
  const { cacheKey, url } = arcBundle(arcId);
  let bundle: string;
  try {
    bundle = await loadBundle(cacheKey, url, false);
  } catch {
    toast("Couldn't fetch the arc bundle.");
    return;
  }
  await copy(bundle, `Copied ${label} as a prompt.`);
}

export function copyWorkCommand(key: string): void {
  void copy(workCommand(key), `Copied "${workCommand(key)}".`);
}
