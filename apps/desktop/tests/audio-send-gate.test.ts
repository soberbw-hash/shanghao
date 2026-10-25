import assert from "node:assert/strict";
import test from "node:test";
import {
  linkAudioSendGate,
  setAudioSendEnabled,
} from "../src/renderer/src/features/audio/audioSendGate";
test("screen/application mixed audio obeys PTT and phone gates without affecting another room's tracks", () => {
  const track = (enabled: boolean) => ({ enabled }) as MediaStreamTrack;
  const mic = track(false),
    mixed = track(true),
    next = track(true),
    otherMic = track(true),
    otherMixed = track(true);
  const stop = linkAudioSendGate(mic, mixed);
  linkAudioSendGate(otherMic, otherMixed);
  assert.equal(mixed.enabled, false);
  setAudioSendEnabled(mic, true);
  assert.equal(mixed.enabled, true);
  linkAudioSendGate(mic, next);
  setAudioSendEnabled(mic, false);
  assert.equal(mixed.enabled, false);
  assert.equal(next.enabled, false);
  assert.equal(otherMixed.enabled, true);
  stop();
  setAudioSendEnabled(mic, true);
  assert.equal(mixed.enabled, false);
  assert.equal(next.enabled, true);
});
