const js = require("@eslint/js");
const globals = require("globals");
const importPlugin = require("eslint-plugin-import");
const prettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = [
  { ignores: ["dist/"] },
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  // Only this is needed to integrate Prettier, see: https://github.com/prettier/eslint-plugin-prettier#recommended-configuration
  prettierRecommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "no-console": "off", // console log is fine in the context of GitHub Actions
    },
  },
];
