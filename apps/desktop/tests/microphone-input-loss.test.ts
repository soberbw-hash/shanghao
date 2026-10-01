import assert from "node:assert/strict";
import test from "node:test";
import {
  forwardMicrophoneInputLoss,
  MICROPHONE_INPUT_LOST,
} from "../src/renderer/src/features/audio/microphoneInputLoss";

test("input loss forwards only all-ended owned input and detaches on disposal", () => {
  const originalWindow = globalThis.window;
  const target = new EventTarget();
  globalThis.window = target as unknown as Window & typeof globalThis;
  const one = Object.assign(new EventTarget(), { readyState: "live" });
  const two = Object.assign(new EventTarget(), { readyState: "live" });
  const input = { getAudioTracks: () => [one, two] } as unknown as MediaStream;
  const output = {} as MediaStream;
  let notices = 0,
    disposed = false;
  target.addEventListener(MICROPHONE_INPUT_LOST, (event) => {
    assert.equal((event as CustomEvent).detail, output);
    notices++;
  });
  try {
    const detach = forwardMicrophoneInputLoss(input, output, () => disposed);
    one.readyState = "ended";
    one.dispatchEvent(new Event("ended"));
    assert.equal(notices, 0);
    two.readyState = "ended";
    two.dispatchEvent(new Event("ended"));
    assert.equal(notices, 1);
    disposed = true;
    two.dispatchEvent(new Event("ended"));
    assert.equal(notices, 1);
    disposed = false;
    detach();
    one.dispatchEvent(new Event("ended"));
    assert.equal(notices, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});
