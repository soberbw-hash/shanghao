import assert from "node:assert/strict";
import test from "node:test";
import { TemporaryLanReplication } from "../src/main/temporary-lan-replication";
import { TemporaryRoomCoordinator } from "../../../packages/signaling/src/temporary-room-coordinator";
import { TemporaryRoomAuthenticator } from "../../../packages/signaling/src/temporary-room-auth";
import {
  TemporaryRoomReplica,
  type SignedTemporaryCheckpoint,
} from "../../../packages/signaling/src/temporary-room-replica";
import { temporaryTestIdentity } from "./helpers/temporary-test-identity";

for (const reachable of [true, false]) {
  test(`a third-member commit ${reachable ? "survives a simultaneous lease refresh without a stale install" : "still requires the previous majority"}`, async (t) => {
    const identities = [
      temporaryTestIdentity("A"),
      temporaryTestIdentity("B"),
      temporaryTestIdentity("C"),
    ];
    const profiles = await Promise.all(
      identities.map(async (identity) => (await identity.getProfile())!),
    );
    const owner = profiles[0]!;
    const now = Date.now();
    const auth = new TemporaryRoomAuthenticator({ now: () => now });
    const coordinator = new TemporaryRoomCoordinator({
      authorityId: owner.deviceId,
      now: () => now,
    });
    const principal = async (index: number, sessionId?: string) =>
      auth.verify(
        await identities[index]!.signChallenge(
          auth.issueChallenge({ publicKey: profiles[index]!.publicKey, sessionId }),
        ),
      );
    const first = coordinator.create(await principal(0), owner);
    coordinator.join(first.room.code, await principal(1, first.room.sessionId), profiles[1]!);
    const peer = async (index: number) => ({
      endpoint: "wss://127.0.0.1:12345/temporary",
      announcement: await identities[index]!.signLanAnnouncement({
        protocol: 1,
        type: "announcement",
        authorityId: profiles[index]!.deviceId,
        publicKey: profiles[index]!.publicKey,
        sessionId: first.room.sessionId,
        epoch: 1,
        port: 12345,
        certificateSha256: "a".repeat(64),
        discoveryId: "a".repeat(43),
        issuedAt: now,
        expiresAt: now + 15000,
      }),
    });
    const errors: string[] = [];
    const replication = new TemporaryLanReplication({
      identity: identities[0]!,
      coordinator: () => coordinator,
      localEndpoint: async () => peer(0),
      rooms: () => [coordinator.snapshot(first.room.sessionId)],
      activated() {},
      now: () => now,
      onError: (code) => errors.push(code),
    });
    t.after(() => replication.close());
    const internal = replication as unknown as {
      tick(): Promise<void>;
      primaries: Map<
        string,
        {
          bundle: { signed: SignedTemporaryCheckpoint };
          committed: SignedTemporaryCheckpoint;
          peers: Map<string, Awaited<ReturnType<typeof peer>>>;
        }
      >;
      call(
        peer: Awaited<ReturnType<typeof peer>>,
        sessionId: string,
        value: { op: string; bundle: { signed: SignedTemporaryCheckpoint } },
      ): Promise<{ digest: string }>;
    };
    await internal.tick();
    const primary = internal.primaries.get(first.room.sessionId)!;
    primary.committed = primary.bundle.signed;
    primary.peers.set(profiles[1]!.deviceId, await peer(1));
    const replica = new TemporaryRoomReplica({
      sessionId: first.room.sessionId,
      authorityId: owner.deviceId,
      authorityPublicKey: owner.publicKey,
      epoch: 1,
      now: () => now,
    });
    replica.acceptCheckpoint(primary.committed);
    // The transport can deliver a background sync before the in-flight install.
    // Keep real checkpoint signatures, sequence guards and majority accounting.
    internal.call = async (_peer, sessionId, request) => {
      assert.equal(request.op, "install");
      if (!reachable) throw Error("temporary_fixture_offline");
      await internal.tick();
      replica.acceptCheckpoint(internal.primaries.get(sessionId)!.bundle.signed);
      return { digest: replica.acceptCheckpoint(request.bundle.signed) };
    };
    coordinator.join(first.room.code, await principal(2, first.room.sessionId), profiles[2]!);
    if (reachable) {
      await replication.commit(first.room.sessionId);
      assert.equal(replica.checkpoint()?.checkpoint.members.length, 3);
      assert.ok(!errors.includes("temporary_checkpoint_stale"));
      assert.equal(primary.committed.checkpoint.members.length, 3);
    } else {
      await assert.rejects(
        replication.commit(first.room.sessionId),
        /temporary_replica_quorum_required/,
      );
      assert.equal(primary.committed.checkpoint.members.length, 2);
    }
  });
}
