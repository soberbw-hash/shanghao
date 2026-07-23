import js from "@eslint/js";
import promise from "eslint-plugin-promise";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-electron/**",
      "**/release/**",
      "**/node_modules/**",
      "artifacts/**",
      "tmp/**",
      ".pnpm-store/**",
      ".turbo/**",
      "**/.local-*-build/**",
      "apps/desktop-pet/**",
      "apps/network-repair/**",
      "apps/desktop/build/**",
      "apps/desktop/src/renderer/src/assets/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      promise,
      security,
    },
    rules: {
      ...security.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "promise/no-return-wrap": "error",
      "promise/param-names": "error",
      "promise/no-new-statics": "error",
      "promise/valid-params": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-console": "error",
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-child-process": "off",
    },
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "apps/desktop/tests/**/*.ts", "apps/desktop/*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
    rules: {
      "no-console": "off",
      "security/detect-non-literal-regexp": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
