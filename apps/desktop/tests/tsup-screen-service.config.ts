import { defineConfig } from "tsup";
export default defineConfig({
  entry: {
    "electron-screen-service-smoke": "tests/electron-screen-service-smoke.ts",
    "electron-screen-manager-loopback": "tests/electron-screen-manager-loopback.ts",
  },
  outDir: "dist-electron/tests",
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  external: ["electron"],
  noExternal: ["@private-voice/shared"],
  bundle: true,
  clean: false,
});
