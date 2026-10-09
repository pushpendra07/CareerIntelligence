/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The dev server proxies /api to the FastAPI backend, so the browser never needs CORS.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.VITE_API_TARGET || "http://127.0.0.1:8000";
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, proxy: { "/api": target } },
    preview: { port: 4173, proxy: { "/api": target } },
    test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: false, globals: true },
  };
});
