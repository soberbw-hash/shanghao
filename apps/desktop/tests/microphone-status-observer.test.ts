import assert from "node:assert/strict";
import test from "node:test";
import { observeMicrophoneStatus } from "../src/renderer/src/features/audio/microphoneStatusObserver";
import { MICROPHONE_INPUT_LOST } from "../src/renderer/src/features/audio/microphoneInputLoss";

test("status observes owned input loss and track changes without retaining old stream listeners", () => {
  const events = new EventTarget();
  const track = Object.assign(new EventTarget(), {
    readyState: "live",
    enabled: true,
    muted: false,
  });
  const stream = Object.assign(new EventTarget(), {
    getAudioTracks: () => [track],
  }) as unknown as MediaStream;
  const updates: { inputLost: boolean; tracks: { readyState: string; muted: boolean }[] }[] = [];
  const detach = observeMicrophoneStatus(stream, events, (value) => updates.push(value));
  assert.equal(updates.at(-1)?.inputLost, false);
  events.dispatchEvent(new CustomEvent(MICROPHONE_INPUT_LOST, { detail: {} }));
  assert.equal(updates.length, 1);
  track.muted = true;
  track.dispatchEvent(new Event("mute"));
  assert.equal(updates.at(-1)?.tracks[0].muted, true);
  track.muted = false;
  track.dispatchEvent(new Event("unmute"));
  assert.equal(updates.at(-1)?.tracks[0].muted, false);
  events.dispatchEvent(new CustomEvent(MICROPHONE_INPUT_LOST, { detail: stream }));
  assert.equal(updates.at(-1)?.inputLost, true);
  track.readyState = "ended";
  track.dispatchEvent(new Event("ended"));
  assert.equal(updates.at(-1)?.tracks[0].readyState, "ended");
  detach();
  const previous = updates.length;
  track.dispatchEvent(new Event("ended"));
  events.dispatchEvent(new CustomEvent(MICROPHONE_INPUT_LOST, { detail: stream }));
  assert.equal(updates.length, previous);

  const replacement = Object.assign(new EventTarget(), {
    getAudioTracks: () => [],
  }) as unknown as MediaStream;
  const detachReplacement = observeMicrophoneStatus(replacement, events, (value) =>
    updates.push(value),
  );
  assert.equal(updates.at(-1)?.inputLost, false);
  detachReplacement();
});
