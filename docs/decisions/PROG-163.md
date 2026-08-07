### PROG-163 — Theme boot goes external; no more CSP hash to drift

**Status:** accepted (2026-08-07).

**Context.** The stored theme stopped applying on reload in production: the
page reverted to porcelain while the account-menu picker still showed the
chosen preset. Reproduced locally by hashing the built `index.html`'s inline
no-flash boot script and comparing it to the sha256 pin in `public/_headers` —
they didn't match. The pin went stale when a later edit changed the script's
text (the mono preset added an entry to its paper map) without a correctly
regenerated hash, so production CSP silently blocked the script: nothing set
`data-theme` at load, while the picker (which reads localStorage through
`theme.ts`) still showed the stored choice. Dev never surfaced it because
`vite dev` doesn't apply `public/_headers`. Classic pinned-inline failure
mode: the pin is invisible until it's wrong, and it's only wrong in prod.

**Decision.**
1. **The boot script is an external file**, `public/theme-boot.js`, loaded as
   a blocking classic `<script src>` in `index.html`'s head. It's covered by
   `script-src 'self'` forever — there is no hash to regenerate, so the whole
   class of drift bug is gone. The sha256 token is removed from the CSP; the
   policy is back to "no inline scripts, period."
2. **`main.tsx` re-applies the stored theme at mount** (`applyStoredTheme()`)
   as a second line of defense: if the boot script is ever blocked or fails,
   the worst case is one porcelain flash, never a wrong theme for the session.
3. **A drift guard in `theme.test.ts`** parses `public/theme-boot.js` and
   fails if its storage key or paper-color map diverges from `theme.ts`'s
   `THEMES` — the boot script still can't import the module (nothing is
   bundled pre-paint), so the mirror is now enforced instead of commented.

**Trade-off.** One extra ~400B blocking request on first visit (cached after);
accepted — correctness over a micro-optimization that already shipped a broken
production once. Supersedes the "pinned inline script" call in PROG-150's
no-flash boot entry.
