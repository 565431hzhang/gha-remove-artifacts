import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default defineConfig([
  globalIgnores(["dist/"]),
  {
    files: ["**/*.js"],
    extends: [js.configs.recommended, prettierRecommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-console": "off", // console log is fine in the context of GitHub Actions
      "no-duplicate-imports": "error",
    },
  },
]);
