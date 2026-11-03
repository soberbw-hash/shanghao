import { strict as assert } from "node:assert";
import { test } from "node:test";
import { encodeVoiceReplayWave } from "../src/renderer/src/features/recording/voiceReplayWave";

test("replay WAV contains bounded mono PCM with correct header", () => {
  const wave = encodeVoiceReplayWave(new Float32Array([-2, 0, 1, NaN]), 48000);
  const view = new DataView(wave.buffer);
  assert.equal(Buffer.from(wave.subarray(0, 4)).toString(), "RIFF");
  assert.equal(view.getUint32(4, true), wave.length - 8);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 8);
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)),
    [-32768, 0, 32767, 0],
  );
  assert.throws(() => encodeVoiceReplayWave(new Float32Array(61), 1));
});
