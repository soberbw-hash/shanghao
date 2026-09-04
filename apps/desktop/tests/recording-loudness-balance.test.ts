import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceRecordingLoudness,
  createRecordingLoudnessState,
  RECORDING_MAX_BOOST_DB,
  RECORDING_MAX_CUT_DB,
} from "../src/renderer/src/features/recording/recordingLoudnessBalance";

test("recording loudness learner never raises silence or background noise", () => {
  let state = createRecordingLoudnessState();
  for (let index = 0; index < 500; index += 1) {
    state = advanceRecordingLoudness(state, { rms: 0.004, peak: 0.01 }, true);
  }
  assert.equal(state.gainDb, 0);
  assert.equal(state.speechFrames, 0);
});

test("recording fallback loudness gain remains inside +/-6 dB", () => {
  let quiet = createRecordingLoudnessState();
  for (let index = 0; index < 500; index += 1) {
    quiet = advanceRecordingLoudness(quiet, { rms: 0.02, peak: 0.08 }, true);
  }
  assert.ok(quiet.gainDb > 5.5);
  assert.ok(quiet.gainDb <= RECORDING_MAX_BOOST_DB);

  let loud = createRecordingLoudnessState();
  for (let index = 0; index < 20; index += 1) {
    loud = advanceRecordingLoudness(loud, { rms: 0.5, peak: 0.9 }, true);
  }
  assert.ok(loud.gainDb < -5.5);
  assert.ok(loud.gainDb >= RECORDING_MAX_CUT_DB);
});

test("disabling recording loudness balance returns unity without erasing learned speech state", () => {
  let state = createRecordingLoudnessState();
  for (let index = 0; index < 100; index += 1) {
    state = advanceRecordingLoudness(state, { rms: 0.03, peak: 0.1 }, true);
  }
  const speechFrames = state.speechFrames;
  state = advanceRecordingLoudness(state, { rms: 0.03, peak: 0.1 }, false);
  assert.equal(state.gainDb, 0);
  assert.equal(state.speechFrames, speechFrames);
});

test("five strongly different talkers converge without sharing recording gain state", () => {
  const inputs = [0.018, 0.03, 0.06, 0.14, 0.5];
  const states = inputs.map(() => createRecordingLoudnessState());
  for (let frame = 0; frame < 600; frame += 1) {
    for (let index = 0; index < states.length; index += 1) {
      states[index] = advanceRecordingLoudness(
        states[index]!,
        { rms: inputs[index]!, peak: Math.min(0.95, inputs[index]! * 2.5) },
        true,
      );
    }
  }
  assert.ok(states[0]!.gainDb > 5.5);
  assert.ok(states[4]!.gainDb < -5.5);
  assert.equal(new Set(states.map((state) => state.speechFrames)).size, 1);
  assert.ok(states.every((state) => state.gainDb >= -6 && state.gainDb <= 6));
});
