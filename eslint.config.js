import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    // Build output, deps, and the Spec Kit install (markdown + machine state, not source).
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "cloneweb/**",
      "src/specs/**",
      "src/.specify/**",
      ".codegraph/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Principle VI: no dead code or debug debris on main.
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // MAIN-01 / Prohibited Patterns: `any` is not an escape hatch on boundary data.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // ---- Frontend ----
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // research R1: one root node_modules means nothing else stops the frontend
      // reaching into server code. This rule is the boundary.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/server/*", "server/*"],
              message:
                "Frontend must not import server code. Cross the boundary through shared/contracts only (Principle VI).",
            },
          ],
        },
      ],
    },
  },

  // ---- Backend ----
  {
    files: ["server/**/*.ts"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly" },
    },
    rules: {
      // No import restriction in this direction. A relative specifier cannot
      // distinguish the frontend's `src/lib/*` from the server's own
      // `server/src/lib/*`, and the dangerous direction is the other one:
      // frontend importing server code would bundle secrets into the browser.
      // That is restricted above. Enforcing this side too would need a path-
      // aware plugin for no real risk (Principle V).
    },
  },

  // Tests may use console for diagnostics.
  {
    files: ["server/tests/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
