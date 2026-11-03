import { defineConfig } from "tsup";
export default defineConfig({
  entry: { "chat-mix-core": "tests/chat-mix-native-entry.ts" },
  outDir: "../../artifacts/chat-mix-native",
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  bundle: true,
  clean: false,
  external: ["electron"],
  noExternal: [/^@private-voice\//],
});
