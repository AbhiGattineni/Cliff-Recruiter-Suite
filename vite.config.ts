import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // Don't watch the unrelated nested project / python venv that lives in this folder.
    watch: {
      ignored: ["**/IindimitraApp/**", "**/venv/**", "**/__pycache__/**"],
    },
  },
  // Only scan our own entry for dependency pre-bundling, so Vite ignores stray
  // .html files inside IindimitraApp (e.g. strawberry's pathfinder.html).
  optimizeDeps: {
    entries: ["index.html"],
  },
});
