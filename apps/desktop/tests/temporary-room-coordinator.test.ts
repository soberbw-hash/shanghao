import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  TemporaryRoomAuthenticator,
  temporaryAuthSigningPayload,
} from "../../../packages/signaling/src/temporary-room-auth";
import { TemporaryRoomCoordinator } from "../../../packages/signaling/src/temporary-room-coordinator";
import {
  formatTemporaryRoomCode,
  normalizeTemporaryRoomCode,
} from "../../../packages/shared/src/utils/temporary-room-code";

const identity = (now: () => number = Date.now, sessionId?: string) => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const auth = new TemporaryRoomAuthenticator({ now });
  const challenge = auth.issueChallenge({ publicKey, sessionId });
  return auth.verify({
    challengeId: challenge.challengeId,
    publicKey,
    signature: sign(
      null,
      Buffer.from(temporaryAuthSigningPayload(challenge)),
      keys.privateKey,
    ).toString("base64url"),
  });
};
const version = (room: { epoch: number; revision: number }) => ({
  epoch: room.epoch,
  revision: room.revision,
});

test("eight-digit code parsing preserves leading zeroes and rejects non-numeric joins", () => {
  assert.equal(normalizeTemporaryRoomCode(" 0123 4567 "), "01234567");
  assert.equal(formatTemporaryRoomCode("01234567"), "0123 4567");
  for (const bad of ["1234567", "123456789", "1234-5678", "１２３４５６７８", 12345678])
    assert.equal(normalizeTemporaryRoomCode(bad), undefined);
});
test("a backwards authority clock permanently fences writes and checkpoint renewal instead of extending an old lease", () => {
  let now = 10000;
  const coordinator = new TemporaryRoomCoordinator({ now: () => now }),
    first = coordinator.create(
      identity(() => now),
      { nickname: "A" },
    );
  coordinator.setAuthorityLease(first.room.sessionId, now + 5000);
  now = 9000;
  assert.throws(() => coordinator.authenticate(first.ticket), /authority_fenced/);
  assert.throws(
    () => coordinator.exportCheckpoint(first.room.sessionId, { leaseExpiresAt: now + 5000 }),
    /authority_fenced/,
  );
  now = 12000;
  assert.throws(() => coordinator.authenticate(first.ticket), /authority_fenced/);
  assert.throws(
    () =>
      coordinator.create(
        identity(() => now),
        { nickname: "B" },
      ),
    /authority_fenced/,
  );
});

test("creation retries occupied codes and never reuses the internal session identity", () => {
  const codes = [0, 0, 1];
  const coordinator = new TemporaryRoomCoordinator({ randomCode: () => codes.shift() ?? 1 });
  const a = coordinator.create(identity(), { nickname: "A" });
  const b = coordinator.create(identity(), { nickname: "B" });
  assert.equal(a.room.code, "00000000");
  assert.equal(b.room.code, "00000001");
  assert.notEqual(a.room.sessionId, b.room.sessionId);
  assert.match(a.room.sessionId, /^temp_[a-f0-9]{32}$/);
  assert.throws(() => coordinator.create(identity(), { nickname: "C" }), /code_unavailable/);
  assert.equal(coordinator.getStats().rooms, 2);
});

test("five seats include grace members, rejected joins and duplicate devices do not steal seats", () => {
  const coordinator = new TemporaryRoomCoordinator();
  const creator = identity();
  const first = coordinator.create(creator, { nickname: "A" });
  for (const nickname of ["B", "C", "D", "E"])
    coordinator.join(first.room.code, identity(), { nickname });
  assert.throws(
    () => coordinator.join(first.room.code, identity(), { nickname: "F" }),
    /room_full/,
  );
  assert.throws(
    () => coordinator.join(first.room.code, creator, { nickname: "Other" }),
    /device_already_joined/,
  );
  coordinator.disconnect(first.ticket);
  assert.throws(
    () => coordinator.join(first.room.code, identity(), { nickname: "F" }),
    /room_full/,
  );
  assert.equal(coordinator.snapshot(first.room.sessionId).members.length, 5);
});

test("management checks role and exact epoch/revision while rotation preserves existing member tickets", () => {
  const coordinator = new TemporaryRoomCoordinator();
  const a = coordinator.create(identity(), { nickname: "A" });
  const b = coordinator.join(a.room.code, identity(), { nickname: "B" });
  const current = coordinator.snapshot(a.room.sessionId);
  assert.throws(() => coordinator.setLocked(b.ticket, true, version(current)), /admin_required/);
  assert.throws(() => coordinator.setLocked(a.ticket, true, version(a.room)), /version_conflict/);
  assert.throws(
    () =>
      coordinator.setLocked(a.ticket, true, {
        epoch: current.epoch - 1,
        revision: current.revision,
      }),
    /version_conflict/,
  );
  const locked = coordinator.setLocked(a.ticket, true, version(current));
  assert.throws(() => coordinator.join(a.room.code, identity(), { nickname: "C" }), /room_locked/);
  const rotated = coordinator.rotateCode(a.ticket, version(locked));
  assert.notEqual(rotated.code, a.room.code);
  assert.throws(
    () => coordinator.join(a.room.code, identity(), { nickname: "C" }),
    /room_not_found/,
  );
  assert.equal(coordinator.authenticate(b.ticket).memberId, b.member.memberId);
});

test("creator leave transfers management and the last explicit leave destroys room and old tickets", () => {
  const coordinator = new TemporaryRoomCoordinator();
  const a = coordinator.create(identity(), { nickname: "A" });
  const b = coordinator.join(a.room.code, identity(), { nickname: "B" });
  const after = coordinator.leave(a.ticket);
  assert.equal(after?.adminMemberId, b.member.memberId);
  assert.equal(after?.code, a.room.code);
  assert.throws(() => coordinator.authenticate(a.ticket), /ticket_invalid/);
  assert.equal(coordinator.leave(b.ticket), undefined);
  assert.throws(() => coordinator.snapshot(a.room.sessionId), /room_not_found/);
  assert.throws(
    () => coordinator.join(a.room.code, identity(), { nickname: "C" }),
    /room_not_found/,
  );
  assert.equal(coordinator.getStats().rooms, 0);
});

test("last active leave preserves disconnected members until the exact 30-second deadline", () => {
  let now = 0;
  const coordinator = new TemporaryRoomCoordinator({ now: () => now });
  const a = coordinator.create(
    identity(() => now),
    { nickname: "A" },
  );
  const bIdentity = identity(() => now);
  const b = coordinator.join(a.room.code, bIdentity, { nickname: "B" });
  coordinator.disconnect(b.ticket);
  const after = coordinator.leave(a.ticket);
  assert.equal(after?.state, "reconnecting");
  now = 29999;
  assert.equal(coordinator.snapshot(a.room.sessionId).members.length, 1);
  now = 30000;
  assert.deepEqual(coordinator.sweep(), [a.room.sessionId]);
  assert.throws(() => coordinator.resume(b.ticket, bIdentity), /ticket_invalid/);
});

test("resume rotates credentials and old socket callbacks cannot disconnect the new generation", () => {
  const coordinator = new TemporaryRoomCoordinator();
  const principal = identity();
  const a = coordinator.create(principal, { nickname: "A" });
  coordinator.disconnect(a.ticket);
  const resumed = coordinator.resume(a.ticket, principal);
  assert.equal(resumed.member.memberId, a.member.memberId);
  assert.equal(resumed.ticket.generation, a.ticket.generation + 1);
  assert.notEqual(resumed.ticket.token, a.ticket.token);
  assert.throws(() => coordinator.disconnect(a.ticket), /ticket_invalid/);
  assert.throws(() => coordinator.resume(resumed.ticket, identity()), /identity_mismatch/);
  assert.equal(coordinator.authenticate(resumed.ticket).state, "connected");
});

test("kick revokes every old ticket and prevents same-device re-entry with the current code", () => {
  const coordinator = new TemporaryRoomCoordinator();
  const a = coordinator.create(identity(), { nickname: "A" });
  const principal = identity();
  const b = coordinator.join(a.room.code, principal, { nickname: "B" });
  coordinator.kick(a.ticket, b.member.memberId, version(b.room));
  assert.throws(() => coordinator.resume(b.ticket, principal), /ticket_invalid/);
  assert.throws(
    () => coordinator.join(a.room.code, principal, { nickname: "B" }),
    /member_removed/,
  );
  assert.equal(coordinator.snapshot(a.room.sessionId).members.length, 1);
});

test("bounded removal history stops new admission until code rotation without reviving old tickets", () => {
  const coordinator = new TemporaryRoomCoordinator({ maxRemovedDevices: 1 });
  const a = coordinator.create(identity(), { nickname: "A" });
  const principal = identity();
  const b = coordinator.join(a.room.code, principal, { nickname: "B" });
  const removed = coordinator.kick(a.ticket, b.member.memberId, version(b.room));
  assert.throws(
    () => coordinator.join(a.room.code, identity(), { nickname: "C" }),
    /admission_limit/,
  );
  const rotated = coordinator.rotateCode(a.ticket, version(removed));
  assert.doesNotThrow(() => coordinator.join(rotated.code, principal, { nickname: "B" }));
  assert.throws(() => coordinator.resume(b.ticket, principal), /ticket_invalid/);
});

test("unverified principals, wrong challenge session and malformed profiles never mutate a room", () => {
  const coordinator = new TemporaryRoomCoordinator();
  const principal = identity();
  assert.throws(
    () => coordinator.create({ ...principal } as never, { nickname: "A" }),
    /identity_unverified/,
  );
  const a = coordinator.create(principal, { nickname: "A" });
  assert.throws(
    () => coordinator.join(a.room.code, identity(Date.now, "different-room"), { nickname: "B" }),
    /identity_mismatch/,
  );
  for (const nickname of ["", "\u0000", "x".repeat(21)])
    assert.throws(() => coordinator.join(a.room.code, identity(), { nickname }), /profile_invalid/);
  const copy = coordinator.snapshot(a.room.sessionId);
  copy.members.length = 0;
  assert.equal(coordinator.snapshot(a.room.sessionId).members.length, 1);
});

test("authority handoff advances epoch without changing members or tickets and rejects old authority versions", () => {
  const coordinator = new TemporaryRoomCoordinator({ authorityId: "lan-a" });
  const a = coordinator.create(identity(), { nickname: "A" });
  const b = coordinator.join(a.room.code, identity(), { nickname: "B" });
  const moved = coordinator.transferAuthority(a.ticket, "lan-b", version(b.room));
  assert.equal(moved.authorityId, "lan-b");
  assert.equal(moved.epoch, b.room.epoch + 1);
  assert.equal(moved.sessionId, a.room.sessionId);
  assert.equal(coordinator.authenticate(b.ticket).memberId, b.member.memberId);
  assert.throws(() => coordinator.setLocked(a.ticket, true, version(b.room)), /version_conflict/);
});

test("idle sockets enter bounded grace and connected heartbeats cannot resurrect an expired session", () => {
  let now = 0;
  const coordinator = new TemporaryRoomCoordinator({ now: () => now, heartbeatTimeoutMs: 1000 });
  const a = coordinator.create(
    identity(() => now),
    { nickname: "A" },
  );
  now = 999;
  coordinator.heartbeat(a.ticket);
  now = 1999;
  assert.equal(coordinator.snapshot(a.room.sessionId).state, "reconnecting");
  assert.throws(() => coordinator.heartbeat(a.ticket), /member_disconnected/);
  now = 31999;
  assert.throws(() => coordinator.snapshot(a.room.sessionId), /room_not_found/);
});
