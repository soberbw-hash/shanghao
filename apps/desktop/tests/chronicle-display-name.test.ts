import assert from "node:assert/strict";
import test from "node:test";
import {
  readChronicleDisplayName,
  saveChronicleDisplayName,
} from "../src/renderer/src/features/room/chronicleDisplayName";
import { isSignalEnvelope } from "../../../packages/signaling/src/protocol";

test("chronicle names are optional, account-scoped, and do not change the account profile", (t) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  saveChronicleDisplayName("account-a", "尤博文");
  assert.equal(readChronicleDisplayName("account-a"), "尤博文");
  assert.equal(readChronicleDisplayName("account-b"), undefined);
  assert.throws(() => saveChronicleDisplayName("account-a", "\ninvalid"));
  saveChronicleDisplayName("account-a", "");
  assert.equal(readChronicleDisplayName("account-a"), undefined);
});

test("audio protocol permits only a bounded valid name for the authenticated speaker", () => {
  const audio = {
    type: "chronicle_audio",
    roomId: "main",
    peerId: "a",
    sessionId: "session",
    chunkId: "chunk",
    startedAt: 1,
    durationMs: 1000,
    mime: "audio/webm",
    data: "YXVkaW8=",
  };
  assert.equal(isSignalEnvelope(audio), true);
  assert.equal(isSignalEnvelope({ ...audio, speakerName: "尤博文" }), true);
  assert.equal(isSignalEnvelope({ ...audio, speakerName: "\ninvalid" }), false);
  assert.equal(isSignalEnvelope({ ...audio, speakerName: "过".repeat(17) }), false);
});
