import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    copyPublicDir: false,
    rollupOptions: { input: { home: "index.html", join: "join.html" } },
  },
});
