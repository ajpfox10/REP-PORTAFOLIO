import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Configura el build del frontend React dentro del monolito.
export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5174,
    proxy: {
      "/api": "http://192.168.0.21:4001",
    },
  },
});
