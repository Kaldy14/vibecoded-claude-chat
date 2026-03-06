import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3774,
    proxy: {
      "/api": "http://localhost:3775",
      "/ws": {
        target: "ws://localhost:3775",
        ws: true,
      },
    },
  },
});
