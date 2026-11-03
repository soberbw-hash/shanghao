import { strict as assert } from "node:assert";
import { test } from "node:test";
import { VoiceReplaySession } from "../src/renderer/src/features/recording/voiceReplaySession";

test("replay captures only with unanimous current consent and clears on membership change", () => {
  const session = new VoiceReplaySession(2);
  const epoch = session.updateMembers(["a", "b"]);
  session.append(new Float32Array([1]));
  assert.equal(session.approve("a", epoch), false);
  assert.throws(() => session.snapshot(15), /not_authorized/);
  assert.equal(session.approve("b", epoch), true);
  session.append(new Float32Array([0.5, -0.5]));
  assert.equal(new DataView(session.snapshot(15).buffer).getUint32(40, true), 4);
  const nextEpoch = session.updateMembers(["a", "b", "c"]);
  assert.equal(session.approve("c", epoch), false);
  assert.throws(() => session.snapshot(15), /not_authorized/);
  for (const id of ["a", "b", "c"]) session.approve(id, nextEpoch);
  assert.equal(new DataView(session.snapshot(15).buffer).getUint32(40, true), 0);
  session.append(new Float32Array([1]));
  session.revoke("b", nextEpoch);
  assert.throws(() => session.snapshot(15), /not_authorized/);
  session.approve("b", nextEpoch);
  assert.equal(new DataView(session.snapshot(15).buffer).getUint32(40, true), 0);
  session.close();
  assert.throws(() => session.snapshot(15), /not_authorized/);
});
