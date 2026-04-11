import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const resolvePath = (...segments: string[]) => path.resolve(currentDirectory, ...segments);

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": resolvePath("src/renderer/src"),
      "@private-voice/shared": resolvePath("../../packages/shared/src"),
      "@private-voice/signaling": resolvePath("../../packages/signaling/src"),
      "@private-voice/webrtc": resolvePath("../../packages/webrtc/src"),
      "@private-voice/recording": resolvePath("../../packages/recording/src"),
      "@private-voice/ui": resolvePath("../../packages/ui/src"),
    },
  },
  root: resolvePath("src/renderer"),
  build: {
    outDir: resolvePath("dist"),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
