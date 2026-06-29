// Server-rendered HTML for auth dead-ends (PROG-57). The OAuth callback is a
// full-page navigation, so when a successfully-authenticated Google user isn't
// on the allowlist they land directly on the Worker response — a raw JSON
// `{"error":"not authorized"}` reads as a bug, not a closed door. This renders
// a friendly page in the app's visual identity instead (mirrors SignIn.tsx:
// canvas background, brand mark, Spectral headings, Adobe accent).
//
// It is standalone HTML — the React bundle and Tailwind aren't loaded at
// `/api/auth/callback` — so the brand tokens are inlined rather than imported.

// Where access requests should go (per PROG-57). Plain const so the copy and
// the mailto target can never drift apart.
const REQUEST_ACCESS_EMAIL = "bryan@bryankennedy.org";

export function notAuthorizedPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Access required · Progress</title>
    <link rel="icon" type="image/svg+xml" href="/brand-assets/progress-icon.svg" />
    <meta name="theme-color" content="#f5efe0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --canvas: #f0e9d9;
        --ink: #2c241b;
        --ink-soft: #6b5f4d;
        --adobe: #bb6f50;
        --adobe-deep: #8f5340;
        --font-serif: 'Spectral', Georgia, serif;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; }
      body {
        display: flex;
        min-height: 100vh;
        min-height: 100dvh;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background: var(--canvas);
        color: var(--ink);
        font-family: var(--font-serif);
        text-align: center;
        -webkit-font-smoothing: antialiased;
      }
      .card { width: 100%; max-width: 24rem; }
      .mark {
        width: 88px;
        height: 88px;
        border-radius: 1rem;
        box-shadow: 0 1px 2px rgba(44, 36, 27, 0.1);
      }
      h1 {
        margin: 1.5rem 0 0;
        font-size: 1.5rem;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      p {
        margin: 0.75rem 0 0;
        font-size: 0.95rem;
        line-height: 1.55;
        color: var(--ink-soft);
      }
      a.email {
        color: var(--adobe);
        font-weight: 500;
        text-decoration: none;
      }
      a.email:hover { color: var(--adobe-deep); text-decoration: underline; }
    </style>
  </head>
  <body>
    <main class="card">
      <img class="mark" src="/brand-assets/progress-icon.svg" alt="Progress" width="88" height="88" />
      <h1>This is a private tool</h1>
      <p>
        To request access please email
        <a class="email" href="mailto:${REQUEST_ACCESS_EMAIL}">${REQUEST_ACCESS_EMAIL}</a>.
      </p>
    </main>
  </body>
</html>`;
}
