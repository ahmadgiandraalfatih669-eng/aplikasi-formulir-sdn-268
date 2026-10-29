import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/ui/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        school: { 50: "#eff6ff", 100: "#dbeafe", 600: "#2563eb", 700: "#1d4ed8", 900: "#1e3a8a" },
        primary: "#7B61FF",
        secondary: "#00D4FF",
        success: "#00FF94",
        warning: "#FFB800",
        danger: "#FF4D6D",
        pink: "#FF6EC7",
        canvas: "#0A0F1F",
      },
      borderRadius: { ds: "24px", "ds-md": "18px", pill: "999px" },
      boxShadow: {
        ds: "0 8px 24px rgba(0,0,0,.2)",
        "ds-lg": "0 12px 40px rgba(0,0,0,.3)",
        neon: "0 0 32px rgba(123,97,255,.6)",
      },
      fontFamily: {
        sans: ["Inter", "Plus Jakarta Sans", "Arial", "sans-serif"],
        display: ["Space Grotesk", "Inter", "sans-serif"],
      },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(12px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: { "fade-up": "fade-up 300ms ease both" },
    },
  },
  plugins: [],
} satisfies Config;
