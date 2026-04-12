import { defineConfig } from "tsup";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    "main/index": path.join(currentDirectory, "src/main/index.ts"),
    "preload/index": path.join(currentDirectory, "src/preload/index.ts"),
  },
  clean: true,
  dts: false,
  format: ["cjs"],
  outDir: "dist-electron",
  outExtension() {
    return {
      js: ".cjs",
    };
  },
  platform: "node",
  sourcemap: true,
  splitting: false,
  external: [/^electron($|\/)/, "ffmpeg-static", "ffprobe-static"],
  noExternal: [/^@private-voice\//, "ws"],
});
