import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],

  root: path.resolve(__dirname, "src/renderer"),

  base: "./",

  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: { input: { main: path.resolve(__dirname, "src/renderer/index.html"), controller: path.resolve(__dirname, "src/renderer/controller.html") } }
  },

  server: {
    port: 5173,
    strictPort: true
  }
});
