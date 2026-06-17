// "Work on this" (SPEC §11.2, PROG-19): hand an issue's context bundle to a
// Claude Code session. In-app we offer two clipboard actions — copy the bundle
// Markdown as a prompt (the §11.1 "copy as prompt" button), or copy the
// `progress work <KEY>` CLI one-liner that fetches the bundle and launches
// `claude` in the right checkout (bin/progress.ts, see SETUP §7).
//
// The bundle comes from GET /api/issues/:key/bundle (text/markdown). It's
// cached and prefetched on issue load so the copy is instant — no interaction
// spinner (SPEC §8.2).

import { toast } from "./toast";

const bundleCache = new Map<string, string>();

async function getBundle(key: string): Promise<string> {
  const cached = bundleCache.get(key);
  if (cached !== undefined) return cached;
  const res = await fetch(`/api/issues/${key}/bundle`);
  if (!res.ok) throw new Error(`bundle fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  bundleCache.set(key, text);
  return text;
}

// Warm the cache when an issue page mounts, so a later click copies instantly
// (and within the clipboard's user-activation window).
export function prefetchBundle(key: string): void {
  void getBundle(key).catch(() => {
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
  let bundle: string;
  try {
    bundle = await getBundle(key);
  } catch {
    toast("Couldn't fetch the issue bundle.");
    return;
  }
  await copy(bundle, `Copied ${key} as a prompt.`);
}

export function copyWorkCommand(key: string): void {
  void copy(workCommand(key), `Copied "${workCommand(key)}".`);
}
