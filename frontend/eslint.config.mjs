import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    // Vendored react-bits WebGL components.
    //
    // These are third-party shader implementations kept as-is so they can be
    // diffed against upstream. They rely on `any` for raw GL/uniform plumbing
    // and on expression statements inside the render loop. Rewriting them to
    // satisfy our lint profile would fork them from upstream for no functional
    // gain, so the relevant rules are relaxed for this directory only rather
    // than weakened project-wide.
    files: ["src/components/react-bits/**/*.{ts,tsx}"],
    // Upstream keeps its own `eslint-disable` headers; once the rules above are
    // off those directives read as unused, so stop reporting that too.
    linterOptions: { reportUnusedDisableDirectives: false },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },

  {
    ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
];

export default eslintConfig;
