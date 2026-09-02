import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/",
  plugins: [tailwindcss(), react()],
  server: {
    allowedHosts: ["f483-85-127-44-161.ngrok-free.app"],
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/screenshots": {
        target: "http://localhost:3100",
        changeOrigin: true,
        // The SPA page lives at exactly /screenshots; only the image paths below it
        // (/screenshots/<jobId>/… and /screenshots-thumb/…) belong to the backend.
        bypass(req) {
          const path = req.url?.split("?")[0];
          if (path === "/screenshots" || path === "/screenshots/") return "/index.html";
        },
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
