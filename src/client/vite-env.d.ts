/// <reference types="vite/client" />

// Build-time env the client bundle reads (Vite statically replaces
// `import.meta.env.*`). Declared here so uses are typed instead of `any`.
interface ImportMetaEnv {
  // PostHog project API key — a *public* browser token, not a secret
  // (PROG-137). Unset (all local builds) → analytics is a no-op; CI's deploy
  // job supplies it from the VITE_POSTHOG_KEY Actions secret.
  readonly VITE_POSTHOG_KEY?: string;
}
