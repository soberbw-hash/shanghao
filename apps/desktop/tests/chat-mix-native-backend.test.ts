import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { NativeChatMixBackend } from "../src/main/chat-mix-native-backend";

test("a missing helper rejects promptly without leaking its path and disposal rejects queued commands", async () => {
  const missing = path.join(os.tmpdir(), `shanghao-missing-${randomUUID()}.exe`);
  const backend = new NativeChatMixBackend(missing);
  try {
    await assert.rejects(backend.list(), { message: "chat_mix_native_unavailable" });
    const first = backend.list(),
      second = backend.list();
    const checks = Promise.all([
      assert.rejects(first, /chat_mix_native_(?:unavailable|closed)/),
      assert.rejects(second, /chat_mix_native_closed/),
    ]);
    backend.dispose();
    await checks;
    await assert.rejects(backend.list(), /chat_mix_native_closed/);
  } finally {
    backend.dispose();
  }
});
