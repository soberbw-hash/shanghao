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
          canvas: "#F5F7FA",
          surface: "#FFFFFF",
          muted: "#F8FAFC",
          line: "#E7ECF2",
          text: "#111827",
          textSoft: "#667085",
          accent: "#4DA3FF",
          success: "#16A34A",
          warning: "#F59E0B",
          danger: "#EF4444",
        },
      },
      borderRadius: {
        panel: "20px",
        card: "16px",
        button: "14px",
      },
      boxShadow: {
        panel: "0 16px 36px rgba(17, 24, 39, 0.08)",
        soft: "0 6px 20px rgba(17, 24, 39, 0.06)",
      },
      backdropBlur: {
        panel: "10px",
      },
    },
  },
  plugins: [],
} satisfies Config;
