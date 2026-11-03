import path from "node:path";
import { defineConfig } from "vite";
import base from "../vite.config.mts";

// Offline static fixtures avoid HMR invalidation while checking async operation ownership.
export default defineConfig({
  ...base,
  root: path.resolve("tests/fixtures"),
  build: {
    outDir: path.resolve("../../artifacts/native-ui"),
    emptyOutDir: false,
    rollupOptions: { input: {
      background: path.resolve("tests/fixtures/background-audio.static.html"),
      replay: path.resolve("tests/fixtures/replay-library.static.html"),
      chronicle: path.resolve("tests/fixtures/room-chronicle.static.html"),
      voiceReplay: path.resolve("tests/fixtures/voice-replay.static.html"),
      memberStatus: path.resolve("tests/fixtures/member-status.static.html"),
      audioPresets: path.resolve("tests/fixtures/audio-device-presets.static.html"),
    } },
  },
});
