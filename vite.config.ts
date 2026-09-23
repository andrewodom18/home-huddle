import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

export default defineConfig({
  base: process.env.SITE_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  test: {
    maxWorkers: 1,
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://127.0.0.1:5173" },
    },
    setupFiles: ["./src/test/setup.ts"],
    exclude: [...configDefaults.exclude, "conversation-display-kit/**", "e2e/**"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
