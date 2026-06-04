import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",
        brand: {
          red: "#E11D2C",
          redDark: "#A81120",
          redLight: "#FCE5E8",
          blue: "#1F4FFF",
          blueDark: "#1638B8",
          blueLight: "#E5ECFF",
        },
        slate: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
        },
        paper: "#FAFAF7",
        paper2: "#F4F1EA",
        success: "#10B981",
        warning: "#F59E0B",
        danger: "#DC2626",
      },
      fontFamily: {
        ui: ["Geist", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Geist", "system-ui", "sans-serif"],
        mono: ["'Geist Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "22px",
        "2xl": "28px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.04)",
        cardLg: "0 12px 32px rgba(15,23,42,.10), 0 4px 10px rgba(15,23,42,.05)",
        red: "0 8px 24px rgba(225, 29, 44, .35)",
        blue: "0 8px 24px rgba(31, 79, 255, .25)",
      },
    },
  },
  plugins: [],
};

export default config;
