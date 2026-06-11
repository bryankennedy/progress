import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: {
    // Bind to all interfaces on port 8000 — the exe.dev proxy's default public
    // port — so the dev server is reachable at https://progress.exe.xyz/.
    host: true,
    port: 8000,
    strictPort: true,
    allowedHosts: [".exe.xyz"],
  },
});
