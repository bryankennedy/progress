import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { queryClient } from "./store";
import { startBackgroundSync } from "./sync";
import { initAnalytics } from "./analytics";
import "./styles.css";

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
