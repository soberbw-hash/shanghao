import { defineConfig } from "tsup";
export default defineConfig({
  entry: { "cloud-backend-candidate": "../../artifacts/cloud-backend-candidate-entry.ts" },
  outDir: "../../artifacts", format: ["cjs"], outExtension: () => ({ js: ".cjs" }),
  platform: "node", clean: false, bundle: true, noExternal: [/.*/],
});
