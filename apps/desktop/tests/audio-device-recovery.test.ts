import assert from "node:assert/strict";
import test from "node:test";

import { AudioDeviceState } from "@private-voice/shared";

import {
  createDeviceRefreshVersion,
  missingPreferredAudioDevices,
} from "../src/renderer/src/features/audio/deviceRecovery";

test("a failed enumeration does not clear a selected microphone or speaker", () => {
  assert.deepEqual(
    missingPreferredAudioDevices({
      preferredInputDeviceId: "microphone-1",
      preferredOutputDeviceId: "speaker-1",
      inputDevices: [],
      outputDevices: [],
      inputState: AudioDeviceState.Failed,
      outputState: AudioDeviceState.Failed,
    }),
    { missingInput: false, missingOutput: false },
  );
});

test("a successful enumeration clears only the device that disappeared", () => {
  assert.deepEqual(
    missingPreferredAudioDevices({
      preferredInputDeviceId: "microphone-1",
      preferredOutputDeviceId: "speaker-1",
      inputDevices: [{ id: "microphone-1" }],
      outputDevices: [{ id: "speaker-2" }],
      inputState: AudioDeviceState.Ready,
      outputState: AudioDeviceState.Ready,
    }),
    { missingInput: false, missingOutput: true },
  );
});

test("a preference changed during enumeration is evaluated from the latest settings", () => {
  assert.deepEqual(
    missingPreferredAudioDevices({
      preferredInputDeviceId: "microphone-2",
      inputDevices: [{ id: "microphone-2" }],
      outputDevices: [],
      inputState: AudioDeviceState.Ready,
      outputState: AudioDeviceState.Ready,
    }),
    { missingInput: false, missingOutput: false },
  );
});

test("an older audio enumeration cannot overwrite a newer result", () => {
  const refresh = createDeviceRefreshVersion();
  const older = refresh.begin();
  const newer = refresh.begin();
  assert.equal(refresh.isLatest(older), false);
  assert.equal(refresh.isLatest(newer), true);
});
