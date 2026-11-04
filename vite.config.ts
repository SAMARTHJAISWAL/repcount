import { defineConfig } from "vitest/config";

// Served from https://samarthjaiswal.github.io/repcount/ on GitHub Pages, so every
// asset URL is prefixed with /repcount/. `npm run dev` and `npm run preview` both
// serve under the same base (open http://localhost:5173/repcount/ or :4173/repcount/).
export default defineConfig({
  base: "/repcount/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: { open: "/repcount/" },
  preview: { open: "/repcount/" },
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
