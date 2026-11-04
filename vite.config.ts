import { defineConfig } from "vitest/config";

// Vercel (and local dev) serve the app from the domain root. The GitHub Pages
// mirror lives under /repcount/, so its workflow builds with GITHUB_PAGES=true.
const base = process.env.GITHUB_PAGES === "true" ? "/repcount/" : "/";

export default defineConfig({
  base,
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
});
