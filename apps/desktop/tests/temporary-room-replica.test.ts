import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { TemporaryRoomCoordinator } from "../../../packages/signaling/src/temporary-room-coordinator";
import {
  TemporaryRoomAuthenticator,
  temporaryAuthSigningPayload,
} from "../../../packages/signaling/src/temporary-room-auth";
import {
  TemporaryRoomReplica,
  temporaryCheckpointSigningPayload,
  temporaryReplicaApprovalSigningPayload,
} from "../../../packages/signaling/src/temporary-room-replica";
import { lanDeviceId } from "../src/main/temporary-lan-discovery";
import {
  lanElectionMembershipDigest,
  lanElectionProposalDigest,
  lanElectionVoteSigningPayload,
} from "../src/main/temporary-lan-election";

const device = () => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { ...keys, publicKeyText: publicKey, deviceId: lanDeviceId(publicKey) };
};
type Device = ReturnType<typeof device>;
const principal = (device: Device, now: number, sessionId?: string) => {
  const auth = new TemporaryRoomAuthenticator({ now: () => now });
  const challenge = auth.issueChallenge({ publicKey: device.publicKeyText, sessionId });
  return auth.verify({
    challengeId: challenge.challengeId,
    publicKey: device.publicKeyText,
    signature: sign(
      null,
      Buffer.from(temporaryAuthSigningPayload(challenge)),
      device.privateKey,
    ).toString("base64url"),
  });
};
const version = (room: { epoch: number; revision: number }) => ({
  epoch: room.epoch,
  revision: room.revision,
});
const signCheckpoint = (
  checkpoint: Parameters<typeof temporaryCheckpointSigningPayload>[0],
  owner: Device,
) => ({
  checkpoint,
  signature: sign(
    null,
    Buffer.from(temporaryCheckpointSigningPayload(checkpoint)),
    owner.privateKey,
  ).toString("base64url"),
});

const handoff = (
  replica: TemporaryRoomReplica,
  checkpoint: ReturnType<TemporaryRoomCoordinator["exportCheckpoint"]>,
  devices: Device[],
  now: number,
) => {
  const members = checkpoint.members.map(({ member }) => ({
    deviceId: member.deviceId,
    publicKey: member.publicKey,
  }));
  const proposal = {
    version: 1 as const,
    sessionId: checkpoint.sessionId,
    membershipDigest: lanElectionMembershipDigest(members),
    previousEpoch: checkpoint.epoch,
    epoch: checkpoint.epoch + 1,
    candidateId: devices[1]!.deviceId,
    proposalId: "p".repeat(43),
    issuedAt: now,
    expiresAt: now + 5000,
  };
  const voters = devices
    .filter((device) => members.some((member) => member.deviceId === device.deviceId))
    .slice(1);
  const election = {
    proposal,
    votes: voters.map((device) => {
      const payload = {
        ...proposal,
        voterId: device.deviceId,
        proposalDigest: lanElectionProposalDigest(proposal),
      };
      return {
        payload,
        signature: sign(
          null,
          Buffer.from(lanElectionVoteSigningPayload(payload)),
          device.privateKey,
        ).toString("base64url"),
      };
    }),
  };
  const approvals = voters.map((device) => {
    const payload = replica.approvalFor(election, device.deviceId);
    return {
      payload,
      signature: sign(
        null,
        Buffer.from(temporaryReplicaApprovalSigningPayload(payload)),
        device.privateKey,
      ).toString("base64url"),
    };
  });
  return { election, approvals };
};

test("private checkpoint preserves full room state while migration invalidates tickets and requires fresh device proof", () => {
  let now = 0;
  const devices = [device(), device(), device(), device()];
  const source = new TemporaryRoomCoordinator({
    authorityId: devices[0]!.deviceId,
    now: () => now,
  });
  const a = source.create(principal(devices[0]!, now), { nickname: "A" });
  const b = source.join(a.room.code, principal(devices[1]!, now), { nickname: "B" });
  const c = source.join(a.room.code, principal(devices[2]!, now), { nickname: "C" });
  const d = source.join(a.room.code, principal(devices[3]!, now), { nickname: "D" });
  const rotated = source.rotateCode(a.ticket, version(d.room));
  const removed = source.kick(a.ticket, d.member.memberId, version(rotated));
  source.setLocked(a.ticket, true, version(removed));
  source.disconnect(c.ticket);
  now = 1000;
  const checkpoint = source.exportCheckpoint(a.room.sessionId, {
    leaseExpiresAt: 1500,
    fence: true,
  });
  assert.equal(JSON.stringify(checkpoint).includes(a.ticket.token), false);
  assert.equal(JSON.stringify(checkpoint).includes(b.ticket.token), false);
  assert.throws(() => source.authenticate(a.ticket), /authority_fenced/);
  const replica = new TemporaryRoomReplica({
    sessionId: a.room.sessionId,
    authorityId: devices[0]!.deviceId,
    authorityPublicKey: devices[0]!.publicKeyText,
    epoch: 1,
    now: () => now,
  });
  replica.acceptCheckpoint(signCheckpoint(checkpoint, devices[0]!));
  now = 2000;
  const proof = replica.verifyHandoff(handoff(replica, checkpoint, devices, now));
  const target = new TemporaryRoomCoordinator({
    authorityId: devices[1]!.deviceId,
    now: () => now,
  });
  const imported = target.importCheckpoint(proof);
  assert.equal(imported.code, rotated.code);
  assert.equal(imported.locked, true);
  assert.equal(imported.epoch, 2);
  assert.equal(
    imported.members.find((member) => member.memberId === c.member.memberId)?.reconnectUntil,
    30000,
  );
  assert.throws(() => target.authenticate(b.ticket), /ticket_invalid/);
  assert.throws(
    () =>
      target.recoverMember(
        a.room.sessionId,
        b.member.memberId,
        principal(devices[2]!, now, a.room.sessionId),
        2,
      ),
    /identity_mismatch/,
  );
  assert.throws(
    () => target.recoverMember(a.room.sessionId, b.member.memberId, principal(devices[1]!, now), 2),
    /identity_mismatch/,
  );
  const recovered = target.recoverMember(
    a.room.sessionId,
    b.member.memberId,
    principal(devices[1]!, now, a.room.sessionId),
    2,
  );
  assert.notEqual(recovered.ticket.token, b.ticket.token);
  assert.ok(recovered.ticket.generation > b.ticket.generation);
  assert.equal(target.authenticate(recovered.ticket).memberId, b.member.memberId);
  assert.throws(
    () =>
      target.join(rotated.code, principal(devices[3]!, now, a.room.sessionId), { nickname: "D" }),
    /member_removed/,
  );
  assert.throws(() => target.importCheckpoint(proof), /import_proof_invalid/);
  now = 30000;
  assert.equal(
    target
      .snapshot(a.room.sessionId)
      .members.some((member) => member.memberId === c.member.memberId),
    false,
  );
  now = 31000;
  assert.equal(target.leave(recovered.ticket), undefined);
  assert.throws(() => target.resolveCode(rotated.code), /room_not_found/);
});

test("checkpoint signatures and latest revision prevent rollback of kicked members or rotated codes", () => {
  let now = 1000;
  const devices = [device(), device(), device()];
  const source = new TemporaryRoomCoordinator({
    authorityId: devices[0]!.deviceId,
    now: () => now,
  });
  const a = source.create(principal(devices[0]!, now), { nickname: "A" });
  source.join(a.room.code, principal(devices[1]!, now), { nickname: "B" });
  source.join(a.room.code, principal(devices[2]!, now), { nickname: "C" });
  const old = source.exportCheckpoint(a.room.sessionId, { leaseExpiresAt: 1500 });
  source.rotateCode(a.ticket, version(source.snapshot(a.room.sessionId)));
  const latest = source.exportCheckpoint(a.room.sessionId, { leaseExpiresAt: 1500 });
  const replica = new TemporaryRoomReplica({
    sessionId: a.room.sessionId,
    authorityId: devices[0]!.deviceId,
    authorityPublicKey: devices[0]!.publicKeyText,
    epoch: 1,
    now: () => now,
  });
  replica.acceptCheckpoint(signCheckpoint(latest, devices[0]!));
  assert.throws(
    () => replica.acceptCheckpoint(signCheckpoint(old, devices[0]!)),
    /checkpoint_stale/,
  );
  assert.throws(
    () =>
      replica.acceptCheckpoint({
        ...signCheckpoint(latest, devices[0]!),
        checkpoint: { ...latest, locked: true },
      }),
    /checkpoint_invalid/,
  );
  now = 2000;
  const certificate = handoff(replica, latest, devices, now);
  assert.throws(
    () => replica.verifyHandoff({ ...certificate, approvals: certificate.approvals.slice(0, 1) }),
    /quorum_required/,
  );
  const substituted = {
    ...certificate.approvals[0]!,
    payload: { ...certificate.approvals[0]!.payload, checkpointDigest: "x".repeat(43) },
  };
  assert.throws(
    () =>
      replica.verifyHandoff({
        ...certificate,
        approvals: [substituted, certificate.approvals[1]!],
      }),
    /approval_invalid/,
  );
});

test("last-leave tombstone is replicated and can never import an active room or revive its old code", () => {
  let now = 1000;
  const owner = device();
  const source = new TemporaryRoomCoordinator({ authorityId: owner.deviceId, now: () => now });
  const a = source.create(principal(owner, now), { nickname: "A" });
  const old = source.exportCheckpoint(a.room.sessionId, { leaseExpiresAt: 1500 });
  source.leave(a.ticket);
  const closed = source.exportCheckpoint(a.room.sessionId, { leaseExpiresAt: 1500 });
  assert.equal(closed.status, "closed");
  assert.equal(closed.members.length, 0);
  const replica = new TemporaryRoomReplica({
    sessionId: a.room.sessionId,
    authorityId: owner.deviceId,
    authorityPublicKey: owner.publicKeyText,
    epoch: 1,
    now: () => now,
  });
  replica.acceptCheckpoint(signCheckpoint(closed, owner));
  assert.throws(() => replica.acceptCheckpoint(signCheckpoint(old, owner)), /checkpoint_closed/);
  assert.throws(() => replica.verifyHandoff({} as never), /checkpoint_closed/);
  now = 32000;
  assert.throws(() => source.resolveCode(a.room.code), /room_not_found/);
});

test("unfenced crash checkpoint waits for old authority lease and never extends recovery deadlines", () => {
  let now = 1000;
  const devices = [device(), device(), device()];
  const source = new TemporaryRoomCoordinator({
    authorityId: devices[0]!.deviceId,
    now: () => now,
  });
  const a = source.create(principal(devices[0]!, now), { nickname: "A" });
  source.join(a.room.code, principal(devices[1]!, now), { nickname: "B" });
  source.join(a.room.code, principal(devices[2]!, now), { nickname: "C" });
  const checkpoint = source.exportCheckpoint(a.room.sessionId, { leaseExpiresAt: 5000 });
  const replica = new TemporaryRoomReplica({
    sessionId: a.room.sessionId,
    authorityId: devices[0]!.deviceId,
    authorityPublicKey: devices[0]!.publicKeyText,
    epoch: 1,
    now: () => now,
  });
  replica.acceptCheckpoint(signCheckpoint(checkpoint, devices[0]!));
  assert.throws(
    () => replica.approvalFor({ proposal: { previousEpoch: 1 } } as never, devices[1]!.deviceId),
    /lease_active/,
  );
  now = 6000;
  const proof = replica.verifyHandoff(handoff(replica, checkpoint, devices, now));
  const target = new TemporaryRoomCoordinator({
    authorityId: devices[1]!.deviceId,
    now: () => now,
  });
  target.importCheckpoint(proof);
  assert.equal(target.snapshot(a.room.sessionId).members[0]?.reconnectUntil, 31000);
  assert.throws(() => target.importCheckpoint({ ...proof } as never), /import_proof_invalid/);
  now = 31000;
  assert.throws(() => target.snapshot(a.room.sessionId), /room_not_found/);
});

test("exact checkpoint retries are idempotent but forged import JSON, wrong targets and expired certificates are rejected", () => {
  let now = 1000;
  const devices = [device(), device(), device()];
  const source = new TemporaryRoomCoordinator({
    authorityId: devices[0]!.deviceId,
    now: () => now,
  });
  const a = source.create(principal(devices[0]!, now), { nickname: "A" });
  source.join(a.room.code, principal(devices[1]!, now), { nickname: "B" });
  source.join(a.room.code, principal(devices[2]!, now), { nickname: "C" });
  const checkpoint = source.exportCheckpoint(a.room.sessionId, {
    leaseExpiresAt: 1500,
    fence: true,
  });
  const replica = new TemporaryRoomReplica({
    sessionId: a.room.sessionId,
    authorityId: devices[0]!.deviceId,
    authorityPublicKey: devices[0]!.publicKeyText,
    epoch: 1,
    now: () => now,
  });
  const signed = signCheckpoint(checkpoint, devices[0]!);
  const digest = replica.acceptCheckpoint(signed);
  assert.equal(replica.acceptCheckpoint(structuredClone(signed)), digest);
  now = 2000;
  const certificate = handoff(replica, checkpoint, devices, now);
  const proof = replica.verifyHandoff(certificate);
  const target = new TemporaryRoomCoordinator({
    authorityId: devices[1]!.deviceId,
    now: () => now,
  });
  assert.throws(
    () => target.importCheckpoint(JSON.parse(JSON.stringify(proof))),
    /import_proof_invalid/,
  );
  assert.throws(
    () =>
      new TemporaryRoomCoordinator({
        authorityId: devices[2]!.deviceId,
        now: () => now,
      }).importCheckpoint(proof),
    /import_proof_invalid/,
  );
  now = 7000;
  assert.throws(() => target.importCheckpoint(proof), /import_proof_invalid/);
  assert.throws(() => replica.verifyHandoff(certificate), /election_invalid/);
});
