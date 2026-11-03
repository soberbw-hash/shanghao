import { defineConfig } from "tsup";
export default defineConfig({
  entry: { "electron-voice-replay-smoke": "tests/electron-voice-replay-smoke.ts" },
  outDir: "../../artifacts/replay-native",
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  external: ["electron"],
  noExternal: ["@private-voice/shared"],
  bundle: true,
  clean: false,
});
