import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TemporaryInternetDirectory } from "../../../packages/signaling/src/temporary-internet-directory";
import { temporaryTestIdentity } from "./helpers/temporary-test-identity";
import type { TemporaryInternetRegistration } from "../../../packages/signaling/src/temporary-internet-protocol";
async function registration(now: number, sessionId = "temp_" + "a".repeat(32)) {
  const identity = temporaryTestIdentity(),
    profile = (await identity.getProfile())!;
  const payload: TemporaryInternetRegistration = {
    version: 1,
    sessionId,
    authorityId: profile.deviceId,
    publicKey: profile.publicKey,
    epoch: 1,
    revision: 1,
    code: "00001234",
    certificateSha256: "a".repeat(64),
    members: [profile],
    issuedAt: now,
    expiresAt: now + 15000,
  };
  return { identity, payload, signed: await identity.signInternetRegistration(payload) };
}
test("directory restores public authority high-water metadata after restart and terminal records cannot re-register", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-internet-directory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "index.json");
  let now = 1000;
  const original = await registration(now),
    directory = new TemporaryInternetDirectory(
      file,
      () => false,
      () => now,
    );
  await directory.register(original.signed);
  const stored = await readFile(file, "utf8");
  now = 2000;
  await directory.register(
    await original.identity.signInternetRegistration({
      ...original.payload,
      issuedAt: now,
      expiresAt: now + 15000,
    }),
  );
  assert.equal(
    await readFile(file, "utf8"),
    stored,
    "a pure TTL refresh does not rewrite persisted authority state",
  );
  now = 21000;
  const restored = new TemporaryInternetDirectory(
    file,
    () => false,
    () => now,
  );
  await restored.ready;
  assert.equal(restored.hasCode(original.payload.code), true);
  await restored.register(
    await original.identity.signInternetRegistration({
      ...original.payload,
      issuedAt: now,
      expiresAt: now + 15000,
    }),
  );
  await restored.closeSession(original.payload.sessionId, original.payload.authorityId);
  const ended = new TemporaryInternetDirectory(
    file,
    () => false,
    () => now,
  );
  await ended.ready;
  await assert.rejects(
    ended.register(
      await original.identity.signInternetRegistration({
        ...original.payload,
        issuedAt: now,
        expiresAt: now + 15000,
      }),
    ),
    /temporary_bridge_session_closed/,
  );
  assert.equal(ended.hasCode(original.payload.code), false);
  assert.equal(/tokenHash|ticket|checkpoint|pipeId|secret/.test(stored), false);
});
test("concurrent global code reservations atomically commit one owner", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-internet-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "index.json"),
    directory = new TemporaryInternetDirectory(
      file,
      () => false,
      () => 1000,
    );
  const a = await registration(1000),
    b = await registration(1000, "temp_" + "b".repeat(32));
  const results = await Promise.allSettled([
    directory.register(a.signed),
    directory.register(b.signed),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(JSON.parse(await readFile(file, "utf8")).entries.length, 1);
});
test("corrupt or unknown public directory data is preserved and never replaced by a new registration", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-internet-corrupt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "index.json"),
    value = await registration(1000);
  for (const bytes of ["broken", '{"version":9,"entries":[]}']) {
    await writeFile(file, bytes);
    const directory = new TemporaryInternetDirectory(
      file,
      () => false,
      () => 1000,
    );
    await assert.rejects(directory.ready);
    await assert.rejects(directory.register(value.signed));
    assert.equal(await readFile(file, "utf8"), bytes);
  }
});
