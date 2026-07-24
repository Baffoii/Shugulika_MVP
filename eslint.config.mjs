import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs, so we spread them directly
// instead of bridging the legacy `extends` form through FlatCompat.
const eslintConfig = [
  {
    // `next lint` (removed in Next 16) implicitly scoped linting to source dirs
    // and skipped build output, node scripts, and vendored SQL. Replicate that
    // scope for the flat-config `eslint .` invocation.
    ignores: [
      "supabase/**",
      "docs/**",
      "scripts/**",
      ".next/**",
      ".claude/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // eslint-config-next 16 enables the react-hooks v6 "React Compiler" rule
      // set. These flag pre-existing patterns (mount-time state init, Date.now()
      // during render, in-place mutation of locals) that are not regressions
      // from this dependency upgrade. Keep them visible as warnings rather than
      // blocking CI; adopting the React Compiler / refactoring is separate work.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default eslintConfig;
