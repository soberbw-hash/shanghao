import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TemporaryIdentityStore,
  type TemporaryIdentitySecureStorage,
} from "../src/main/temporary-identity-store";
import { TemporaryRoomAuthenticator } from "../../../packages/signaling/src/temporary-room-auth";
import { verifyInternetRegistration } from "../../../packages/signaling/src/temporary-internet-protocol";
import { verifyLanRoomAnnouncement } from "../src/main/temporary-lan-discovery";
import { verifyTemporaryReplicaStateHead } from "../../../packages/signaling/src/temporary-room-state-head";

test("Main's dedicated LAN, directory and state-head signers use the persisted device key and reject foreign or expired identities", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-temp-domains-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const now = 1000,
    store = new TemporaryIdentityStore(root, { secureStorage: encryptedStorage(), now: () => now }),
    profile = await store.saveProfile({ nickname: "签名朋友" });
  const sessionId = "temp_" + "f".repeat(32),
    common = {
      sessionId,
      authorityId: profile.deviceId,
      epoch: 1,
      publicKey: profile.publicKey,
      issuedAt: now,
      expiresAt: now + 15000,
    };
  const announcement = await store.signLanAnnouncement({
    ...common,
    protocol: 1,
    type: "announcement",
    port: 12345,
    certificateSha256: "a".repeat(64),
    discoveryId: "d".repeat(43),
  });
  assert.ok(verifyLanRoomAnnouncement(announcement, now));
  const registration = await store.signInternetRegistration({
    ...common,
    version: 1,
    revision: 1,
    code: "00001234",
    certificateSha256: "a".repeat(64),
    members: [profile],
  });
  assert.ok(verifyInternetRegistration(registration, now));
  const head = await store.signReplicaStateHead({
    version: 1,
    sessionId,
    authorityId: profile.deviceId,
    epoch: 1,
    revision: 1,
    sequence: 1,
    checkpointDigest: "d".repeat(43),
    membershipDigest: "m".repeat(43),
    terminal: false,
    issuedAt: now,
    expiresAt: now + 10000,
  });
  assert.ok(verifyTemporaryReplicaStateHead(head, profile.publicKey, now));
  await assert.rejects(
    store.signInternetRegistration({
      ...registration.payload,
      authorityId: "device_" + "a".repeat(43),
    }),
    /registration_invalid/,
  );
  await assert.rejects(
    store.signInternetRegistration({ ...registration.payload, expiresAt: now }),
    /registration_invalid/,
  );
  await assert.rejects(
    store.signLanAnnouncement({ ...announcement.payload, certificateSha256: "wrong" }),
    /announcement_invalid/,
  );
  await assert.rejects(
    store.signReplicaStateHead({ ...head.payload, authorityId: "device_" + "a".repeat(43) }),
    /head_invalid/,
  );
});

const encryptedStorage = (): TemporaryIdentitySecureStorage => {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: async () => true,
    encrypt: async (plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decrypt: async (data) => {
      const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return {
        plaintext: Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(
          "utf8",
        ),
      };
    },
  };
};

test("local profile and Ed25519 identity survive restart without exposing private key or plaintext on disk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-temp-identity-"));
  try {
    const secureStorage = encryptedStorage();
    const store = new TemporaryIdentityStore(root, { secureStorage });
    assert.equal(await store.getProfile(), undefined);
    const saved = await store.saveProfile({ nickname: "本地朋友", avatarId: "fox" });
    assert.match(saved.deviceId, /^device_[A-Za-z0-9_-]{43}$/);
    assert.equal(
      Object.keys(saved).some((key) => /private|pkcs/i.test(key)),
      false,
    );
    const bytes = await readFile(path.join(root, "temporary-identity.bin"));
    assert.equal(bytes.includes(Buffer.from("本地朋友")), false);
    assert.equal(bytes.includes(Buffer.from("PRIVATE KEY")), false);
    const restored = new TemporaryIdentityStore(root, { secureStorage });
    assert.deepEqual(await restored.getProfile(), saved);
    const changed = await restored.saveProfile({ nickname: "新昵称", avatarId: "cat" });
    assert.equal(changed.deviceId, saved.deviceId);
    assert.equal(changed.publicKey, saved.publicKey);
    assert.deepEqual(await readdir(root), ["temporary-identity.bin"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only typed fresh challenges for the current device and expected authority/session can be signed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-temp-sign-"));
  try {
    let now = 1000;
    const store = new TemporaryIdentityStore(root, {
      secureStorage: encryptedStorage(),
      now: () => now,
    });
    const profile = await store.saveProfile({ nickname: "朋友" });
    const auth = new TemporaryRoomAuthenticator({ now: () => now, audience: "test-lan" });
    const challenge = auth.issueChallenge({
      publicKey: profile.publicKey,
      sessionId: "temp_" + "a".repeat(32),
    });
    const context = { audience: "test-lan", sessionId: challenge.sessionId };
    const proof = await store.signChallenge(challenge, context);
    assert.equal(auth.verify(proof).deviceId, profile.deviceId);
    for (const changed of [
      { ...challenge, nonce: "bad" },
      { ...challenge, version: 2 },
      { ...challenge, deviceId: "device_other" },
      { ...challenge, audience: "other" },
      { ...challenge, sessionId: "temp_" + "b".repeat(32) },
      { ...challenge, expiresAt: now + 999999 },
      "arbitrary shell bytes",
    ])
      await assert.rejects(store.signChallenge(changed as never, context), /challenge_invalid/);
    await assert.rejects(store.signChallenge(challenge, context), /challenge_replayed/);
    now = challenge.expiresAt;
    await assert.rejects(store.signChallenge(challenge, context), /challenge_invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt, unknown-version and undecryptable identity bytes are preserved and cannot be replaced by save", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-temp-corrupt-"));
  try {
    const secureStorage = encryptedStorage();
    const file = path.join(root, "temporary-identity.bin");
    for (const bytes of [
      Buffer.from("damaged"),
      await secureStorage.encrypt(JSON.stringify({ version: 99 })),
    ]) {
      await writeFile(file, bytes);
      const store = new TemporaryIdentityStore(root, { secureStorage });
      await assert.rejects(store.getProfile());
      await assert.rejects(store.saveProfile({ nickname: "新用户" }));
      assert.deepEqual(await readFile(file), bytes);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("secure-store failure and invalid nicknames or avatars never create or overwrite an identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-temp-validation-"));
  try {
    const secureStorage = encryptedStorage();
    const store = new TemporaryIdentityStore(root, { secureStorage });
    for (const profile of [
      { nickname: "" },
      { nickname: "a".repeat(17) },
      { nickname: "a\nb" },
      { nickname: "朋友", avatarId: "not-built-in" },
      { nickname: "朋友", avatarDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
      { nickname: "朋友", avatarDataUrl: "data:image/png;base64," + "A".repeat(180001) },
    ])
      await assert.rejects(store.saveProfile(profile as never), /profile_invalid/);
    assert.deepEqual(await readdir(root), []);
    const saved = await store.saveProfile({ nickname: "朋友" });
    const before = await readFile(path.join(root, "temporary-identity.bin"));
    secureStorage.isEncryptionAvailable = async () => false;
    await assert.rejects(store.saveProfile({ nickname: "其他" }), /secure_storage_unavailable/);
    assert.deepEqual(await readFile(path.join(root, "temporary-identity.bin")), before);
    assert.match(saved.deviceId, /^device_/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
