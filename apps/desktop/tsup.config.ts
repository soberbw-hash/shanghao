import { defineConfig } from "tsup";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    "main/index": path.join(currentDirectory, "src/main/index.ts"),
    "preload/index": path.join(currentDirectory, "src/preload/index.ts"),
    "preload/overlay": path.join(currentDirectory, "src/preload/overlay.ts"),
    "preload/screen-share-viewer": path.join(
      currentDirectory,
      "src/preload/screen-share-viewer.ts",
    ),
    "tests/visual/capture-ui": path.join(currentDirectory, "tests/visual/capture-ui.ts"),
    "tests/electron-recording-playback-smoke": path.join(
      currentDirectory,
      "tests/electron-recording-playback-smoke.ts",
    ),
    "tests/electron-asr-runtime-smoke": path.join(
      currentDirectory,
      "tests/electron-asr-runtime-smoke.ts",
    ),
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
  // Keep source maps for the watched developer process, but do not ship them
  // inside production installers. Runtime logs already preserve useful stacks.
  sourcemap: process.argv.includes("--watch"),
  splitting: false,
  external: [/^electron($|\/)/, "ffmpeg-static", "ffprobe-static"],
  noExternal: [/^@private-voice\//, "ws"],
});
