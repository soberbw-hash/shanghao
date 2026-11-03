import test from "node:test";
import assert from "node:assert/strict";
import { VoiceReplayConsent } from "../src/renderer/src/features/recording/voiceReplayConsent";

test("replay stops and clears when membership changes or a member withdraws consent", () => {
  let clears = 0;
  const consent = new VoiceReplayConsent(() => clears++);
  const first = consent.updateMembers(["a", "b"]);
  assert.equal(consent.approve("a", first), false);
  assert.equal(consent.approve("b", first), true);
  assert.equal(consent.updateMembers(["b", "a"]), first);
  const second = consent.updateMembers(["a", "b", "c"]);
  assert.equal(consent.isEnabled(), false);
  assert.equal(consent.approve("c", first), false);
  for (const member of ["a", "b", "c"]) consent.approve(member, second);
  assert.equal(consent.isEnabled(), true);
  consent.revoke("a", second);
  assert.equal(consent.isEnabled(), false);
  consent.close();
  assert.equal(consent.approve("a", second), false);
  assert.equal(clears, 4);
});
