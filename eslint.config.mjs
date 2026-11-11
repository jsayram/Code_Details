import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Generated output and test artifacts (Phase A D-5: `eslint .` used to lint .next).
  {
    ignores: [".next/**", ".next-test/**", "test-results/**", "playwright-report/**", "blob-report/**", ".test-runtime/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Set all unused variables to warning level instead of error
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
];

export default eslintConfig;
