import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  define: {
    "import.meta.env.TOPOLOGY_SOURCE": JSON.stringify(
      process.env.TOPOLOGY_SOURCE ?? process.env.VITE_TOPOLOGY_SOURCE ?? "hybrid",
    ),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 1421,
    strictPort: true,
  },
});
