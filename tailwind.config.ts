import type { Config } from "tailwindcss";

/**
 * Shugulika design tokens. Green brand palette on a clean white B2B dashboard.
 * Derived from the dashboard prototypes: predominantly white surfaces, a deep
 * green primary, subtle borders, moderate density.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#effaf3",
          100: "#d8f2e1",
          200: "#b3e5c6",
          300: "#82d1a4",
          400: "#4fb77e",
          500: "#2e9d63", // primary green
          600: "#1f7f4e", // primary hover / emphasis
          700: "#1a6641",
          800: "#175236",
          900: "#13432d",
          950: "#082518",
        },
        ink: {
          DEFAULT: "#0f172a",
          muted: "#475569",
          subtle: "#64748b",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f8fafc",
          border: "#e2e8f0",
        },
        status: {
          success: "#1f7f4e",
          info: "#2563eb",
          warn: "#b45309",
          danger: "#b91c1c",
          neutral: "#64748b",
        },
      },
      borderRadius: {
        card: "12px",
        badge: "9999px",
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15,23,42,0.04), 0 1px 3px 0 rgba(15,23,42,0.06)",
        drawer: "-8px 0 24px -12px rgba(15,23,42,0.18)",
        pop: "0 8px 24px -8px rgba(15,23,42,0.20)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};

export default config;
