import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules", ".scratch"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Pure logic must stay free of DOM and MediaPipe so it is testable in Node.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@mediapipe/*", "../app/*"], message: "src/core must not depend on MediaPipe or the UI layer." }] },
      ],
      "no-restricted-globals": ["error", "document", "window", "navigator", "localStorage"],
    },
  },
);
