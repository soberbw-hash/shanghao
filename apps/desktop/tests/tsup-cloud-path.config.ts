import { defineConfig } from "tsup";
export default defineConfig({
  entry: { "cloud-path-probe": "../../artifacts/cloud-path-probe-entry.ts" },
  outDir: "../../artifacts",
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  bundle: true,
  clean: false,
  external: ["electron"],
  noExternal: [/^@private-voice\//, /^@cloudbase\//, /^@supabase\//, /^ws$/, /^ffmpeg-static$/],
});
