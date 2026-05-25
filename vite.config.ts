import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    chunkSizeWarningLimit: 1000, // kB; desktop app — no network concern
  },
  envPrefix: ["VITE_", "TAURI_"],
});
