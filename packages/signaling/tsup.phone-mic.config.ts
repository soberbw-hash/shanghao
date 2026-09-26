import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/phone-mic-sidecar.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "phone-mic-sidecar-dist",
  splitting: false,
  noExternal: ["ws", "@private-voice/shared"],
});
