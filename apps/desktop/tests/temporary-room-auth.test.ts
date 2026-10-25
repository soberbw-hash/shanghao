import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  TemporaryRoomAuthenticator,
  temporaryAuthSigningPayload,
} from "../../../packages/signaling/src/temporary-room-auth";

const device = () => {
  const keys = generateKeyPairSync("ed25519");
  return {
    ...keys,
    publicKeyText: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
};

test("device proof binds the challenge audience, key and session and is single-use", () => {
  const auth = new TemporaryRoomAuthenticator({ audience: "test-authority" });
  const a = device();
  const challenge = auth.issueChallenge({ publicKey: a.publicKeyText, sessionId: "room-a" });
  const signature = sign(
    null,
    Buffer.from(temporaryAuthSigningPayload(challenge)),
    a.privateKey,
  ).toString("base64url");
  const principal = auth.verify({
    challengeId: challenge.challengeId,
    publicKey: a.publicKeyText,
    signature,
  });
  assert.match(principal.deviceId, /^device_[A-Za-z0-9_-]{43}$/);
  assert.equal(principal.audience, "test-authority");
  assert.equal(principal.sessionId, "room-a");
  assert.throws(
    () =>
      auth.verify({ challengeId: challenge.challengeId, publicKey: a.publicKeyText, signature }),
    /challenge_invalid/,
  );
});

test("a different device or modified transcript cannot claim another installation identity", () => {
  const auth = new TemporaryRoomAuthenticator();
  const a = device();
  const b = device();
  const challenge = auth.issueChallenge({ publicKey: a.publicKeyText, sessionId: "room-a" });
  const bad = sign(
    null,
    Buffer.from(temporaryAuthSigningPayload({ ...challenge, sessionId: "room-b" })),
    a.privateKey,
  ).toString("base64url");
  assert.throws(
    () =>
      auth.verify({
        challengeId: challenge.challengeId,
        publicKey: a.publicKeyText,
        signature: bad,
      }),
    /proof_invalid/,
  );
  const next = auth.issueChallenge({ publicKey: a.publicKeyText });
  const signature = sign(
    null,
    Buffer.from(temporaryAuthSigningPayload(next)),
    b.privateKey,
  ).toString("base64url");
  assert.throws(
    () => auth.verify({ challengeId: next.challengeId, publicKey: b.publicKeyText, signature }),
    /proof_invalid/,
  );
});

test("expired challenges fail at their deadline and bounded pending storage releases capacity", () => {
  let now = 100;
  const auth = new TemporaryRoomAuthenticator({
    now: () => now,
    challengeTtlMs: 1000,
    maxPending: 2,
  });
  const a = device();
  const first = auth.issueChallenge({ publicKey: a.publicKeyText });
  auth.issueChallenge({ publicKey: device().publicKeyText });
  assert.throws(
    () => auth.issueChallenge({ publicKey: device().publicKeyText }),
    /challenge_capacity/,
  );
  now = 1100;
  const signature = sign(
    null,
    Buffer.from(temporaryAuthSigningPayload(first)),
    a.privateKey,
  ).toString("base64url");
  assert.throws(
    () => auth.verify({ challengeId: first.challengeId, publicKey: a.publicKeyText, signature }),
    /challenge_invalid/,
  );
  assert.doesNotThrow(() => auth.issueChallenge({ publicKey: a.publicKeyText }));
});

test("invalid key types, oversized keys, malformed signatures and per-device flooding are rejected", () => {
  const auth = new TemporaryRoomAuthenticator({ maxPendingPerDevice: 1 });
  const a = device();
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 })
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
  for (const publicKey of ["x".repeat(2049), "not a key", rsa])
    assert.throws(() => auth.issueChallenge({ publicKey }), /public_key_invalid/);
  const challenge = auth.issueChallenge({ publicKey: a.publicKeyText });
  assert.throws(() => auth.issueChallenge({ publicKey: a.publicKeyText }), /challenge_capacity/);
  assert.throws(
    () =>
      auth.verify({
        challengeId: challenge.challengeId,
        publicKey: a.publicKeyText,
        signature: "A".repeat(1000),
      }),
    /proof_invalid/,
  );
  assert.doesNotThrow(() => auth.issueChallenge({ publicKey: a.publicKeyText }));
});
