import type { Config } from "tailwindcss";

/**
 * Shugulika design tokens. Orange brand palette on clean white/grey surfaces.
 * Derived from the Shugulika recruitment identity: orange tie accent, grey
 * secondary text, dark charcoal portal sidebar.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fef4ef",
          100: "#fde4d6",
          200: "#fbc9ad",
          300: "#f7a275",
          400: "#f07840",
          500: "#e66124", // primary orange (logo tie)
          600: "#d9531e", // primary buttons / emphasis
          700: "#b54318",
          800: "#91361a",
          900: "#752f18",
          950: "#3f150a",
        },
        ink: {
          DEFAULT: "#0f172a",
          muted: "#475569",
          subtle: "#64748b",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f5f5f5",
          border: "#e2e8f0",
        },
        sidebar: {
          DEFAULT: "#1c1c1c",
          border: "#2a2a2a",
          active: "#3d2c28",
          muted: "#9ca3af",
          hover: "rgba(255,255,255,0.06)",
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
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};

export default config;
