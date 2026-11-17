import { strict as assert } from "node:assert";
import { test } from "node:test";
import { VoiceReplaySession } from "../src/renderer/src/features/recording/voiceReplaySession";

test("locally enabled replay buffers audio and clears it when stopped", () => {
  const session = new VoiceReplaySession(4);
  session.append(new Float32Array([0.25, -0.25]));
  const bytes = session.snapshot(15);
  assert.equal(new DataView(bytes.buffer).getUint32(40, true), 4);
  session.close();
  assert.throws(() => session.snapshot(15), /closed/);
});
