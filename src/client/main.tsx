import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { queryClient } from "./store";
import { startBackgroundSync } from "./sync";
import { initAnalytics } from "./analytics";
import { applyStoredTheme } from "./theme";
import "./styles.css";

// Second line of defense for the stored theme (PROG-163): /theme-boot.js
// applies it pre-paint, but if that script is ever blocked or fails, this
// re-apply at mount keeps the choice sticky (one flash instead of a wrong
// theme for the whole session).
applyStoredTheme();

// Passive cross-session sync triggers (PROG-128): window focus/online, a slow
// visible-tab interval. Route changes are wired in App.tsx.
startBackgroundSync();

// PostHog web analytics (PROG-137). No-op unless VITE_POSTHOG_KEY was set at
// build time — i.e. only the CI-built production bundle ever sends events.
initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
