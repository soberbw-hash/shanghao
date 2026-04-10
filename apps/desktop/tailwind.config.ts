import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        app: {
          base: "#0d1118",
          elevated: "#141b26",
          card: "rgba(255,255,255,0.05)",
          line: "rgba(255,255,255,0.08)",
          accent: "#8bd3ff",
          accentStrong: "#6ec4ff",
        },
      },
      borderRadius: {
        panel: "20px",
        card: "16px",
        button: "14px",
      },
      boxShadow: {
        panel: "0 18px 50px rgba(0, 0, 0, 0.28)",
      },
      backdropBlur: {
        panel: "20px",
      },
    },
  },
  plugins: [],
} satisfies Config;
