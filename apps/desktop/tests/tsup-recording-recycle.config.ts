import { defineConfig } from "tsup";
export default defineConfig({
  entry: { "electron-recording-recycle-smoke": "tests/electron-recording-recycle-smoke.ts" },
  outDir: "dist-electron/tests",
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  external: ["electron"],
  noExternal: ["@private-voice/shared"],
  bundle: true,
  clean: false,
});
