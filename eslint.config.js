import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import importPlugin from "eslint-plugin-import";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default defineConfig([
  globalIgnores(["dist/"]),
  {
    files: ["**/*.js"],
    extends: [
      js.configs.recommended,
      importPlugin.flatConfigs.recommended,
      prettierRecommended,
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-console": "off", // console log is fine in the context of GitHub Actions
      "import/no-unresolved": "off", // the node resolver ignores package `exports` maps; ncc fails the build on unresolved imports anyway
    },
  },
]);
