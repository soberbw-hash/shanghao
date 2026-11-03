import assert from "node:assert/strict";
import test from "node:test";
import { createListenOnlyMicrophone } from "../src/renderer/src/features/audio/listenOnlyMicrophone";

test("receive-only track is silent and owned resources are released exactly once", async (t) => {
  const previous = globalThis.AudioContext;
  let stops = 0,
    closes = 0,
    disconnects = 0;
  const track = { enabled: true, stop: () => stops++ };
  const source = {
    offset: { value: 1 },
    connect: () => undefined,
    start: () => undefined,
    stop: () => stops++,
    disconnect: () => disconnects++,
  };
  globalThis.AudioContext = class {
    createConstantSource() {
      return source;
    }
    createMediaStreamDestination() {
      return { channelCount: 2, stream: { getTracks: () => [track] } };
    }
    async resume() {}
    async close() {
      closes++;
    }
  } as unknown as typeof AudioContext;
  t.after(() => {
    globalThis.AudioContext = previous;
  });
  const microphone = await createListenOnlyMicrophone();
  assert.equal(source.offset.value, 0);
  assert.equal(track.enabled, false);
  microphone.setSendVolume(1.5);
  assert.equal(microphone.getSendVolume(), 0);
  microphone.dispose();
  microphone.dispose();
  assert.equal(stops, 2);
  assert.equal(disconnects, 1);
  assert.equal(closes, 1);
});
