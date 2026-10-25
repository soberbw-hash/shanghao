import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { get } from "node:https";
import test from "node:test";
import {
  temporaryCheckpointSigningPayload,
  temporaryReplicaApprovalSigningPayload,
} from "../../../packages/signaling/src/temporary-room-replica";
import { temporaryReplicaStateHeadSigningPayload } from "../../../packages/signaling/src/temporary-room-state-head";
import { internetRegistrationSigningPayload } from "../../../packages/signaling/src/temporary-internet-protocol";
import { lanElectionVoteSigningPayload } from "../src/main/temporary-lan-election";
import {
  TemporaryLanDiscovery,
  lanAnnouncementSigningPayload,
  lanDeviceId,
  type LanRoomAnnouncementPayload,
} from "../src/main/temporary-lan-discovery";
import { TemporaryLanHost } from "../src/main/temporary-lan-host";
import { TemporaryRoomClient } from "../src/main/temporary-room-client";
import { createTemporaryRoomRouter } from "../src/main/temporary-room-router";
import type { TemporaryIdentityStore } from "../src/main/temporary-identity-store";
import {
  temporaryAuthSigningPayload,
  type TemporaryAuthChallenge,
} from "../../../packages/shared/src/types/temporary-room.types";

function identity(nickname: string): TemporaryIdentityStore {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const profile = { nickname, avatarId: "fox", deviceId: lanDeviceId(publicKey), publicKey };
  return {
    signInternetRegistration: async (payload) => ({
      payload,
      signature: sign(
        null,
        Buffer.from(internetRegistrationSigningPayload(payload)),
        pair.privateKey,
      ).toString("base64url"),
    }),
    signCheckpoint: async (checkpoint) => ({
      checkpoint,
      signature: sign(
        null,
        Buffer.from(temporaryCheckpointSigningPayload(checkpoint)),
        pair.privateKey,
      ).toString("base64url"),
    }),
    signReplicaApproval: async (payload) => ({
      payload,
      signature: sign(
        null,
        Buffer.from(temporaryReplicaApprovalSigningPayload(payload)),
        pair.privateKey,
      ).toString("base64url"),
    }),
    signReplicaStateHead: async (payload) => ({
      payload,
      signature: sign(
        null,
        Buffer.from(temporaryReplicaStateHeadSigningPayload(payload)),
        pair.privateKey,
      ).toString("base64url"),
    }),
    signElectionVote: async (payload) => ({
      payload,
      signature: sign(
        null,
        Buffer.from(lanElectionVoteSigningPayload(payload)),
        pair.privateKey,
      ).toString("base64url"),
    }),
    getProfile: async () => profile,
    signChallenge: async (challenge: TemporaryAuthChallenge) => ({
      challengeId: challenge.challengeId,
      publicKey,
      signature: sign(
        null,
        Buffer.from(temporaryAuthSigningPayload(challenge)),
        pair.privateKey,
      ).toString("base64url"),
    }),
    signLanAnnouncement: async (payload: LanRoomAnnouncementPayload) => ({
      payload,
      signature: sign(
        null,
        Buffer.from(lanAnnouncementSigningPayload(payload)),
        pair.privateKey,
      ).toString("base64url"),
    }),
  } as TemporaryIdentityStore;
}

test(
  "offline LAN discovers and authenticates the existing room through pinned TLS; cannot create on another device or access permanent routes",
  { timeout: 15_000 },
  async (t) => {
    const aDiscovery = new TemporaryLanDiscovery({
      bindAddress: "127.0.0.1",
      port: 0,
      allowLoopback: true,
      targets: [],
    });
    const aPort = (await aDiscovery.start()).port;
    const bDiscovery = new TemporaryLanDiscovery({
      bindAddress: "127.0.0.1",
      port: 0,
      allowLoopback: true,
      targets: [{ address: "127.0.0.1", port: aPort }],
    });
    const aId = identity("甲"),
      bId = identity("乙");
    const aHost = new TemporaryLanHost({
      identity: aId,
      discovery: aDiscovery,
      bindAddress: "127.0.0.1",
    });
    const bHost = new TemporaryLanHost({
      identity: bId,
      discovery: bDiscovery,
      bindAddress: "127.0.0.1",
    });
    const route = await aHost.start();
    const a = new TemporaryRoomClient(aId, () => route.url, undefined, {
      resolve: async () => route,
    });
    const b = new TemporaryRoomClient(
      bId,
      () => "ws://127.0.0.1:1",
      undefined,
      createTemporaryRoomRouter({
        identity: bId,
        discovery: bDiscovery,
        host: bHost,
        endpoint: () => "ws://127.0.0.1:1",
      }),
    );
    const foreign = new TemporaryRoomClient(bId, () => route.url, undefined, {
      resolve: async () => route,
    });
    t.after(async () => {
      a.close();
      b.close();
      foreign.close();
      await aHost.close();
      await bHost.close();
      await aDiscovery.stop();
      await bDiscovery.stop();
    });
    const first = await a.create();
    await assert.rejects(foreign.create(), /temporary_creator_not_allowed/);
    const second = await b.join(first.room.code);
    assert.equal(second.roomId, first.roomId);
    assert.equal(second.room.authorityId, first.room.authorityId);
    assert.equal(second.room.members.length, 2);
    assert.equal(JSON.stringify(second).includes("CERTIFICATE"), false);
    assert.equal(JSON.stringify(second).includes('"ticket"'), false);
    for (const path of ["/rooms", "/account/session", "/phone-mic"]) {
      const status = await new Promise<number>((resolve, reject) => {
        const request = get(
          route.url.replace("wss:", "https:").replace("/temporary", path),
          { ca: route.certificate, servername: "shanghao.local", rejectUnauthorized: true },
          (response) => {
            response.resume();
            resolve(response.statusCode!);
          },
        );
        request.on("error", reject);
      });
      assert.equal(status, 404);
    }
    a.release(first.contextId);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    assert.equal(
      (await b.acquire(second.signalingUrl))?.readyState,
      1,
      "host service survives creator leaving while a friend is connected",
    );
  },
);

test("cloud connection failure falls back once to LAN hosting, but a logical rejection does not", async () => {
  let starts = 0;
  const router = createTemporaryRoomRouter({
    identity: identity("甲"),
    discovery: {} as TemporaryLanDiscovery,
    host: {
      start: async () => {
        starts++;
        return { url: "wss://127.0.0.1:123/temporary" };
      },
    } as TemporaryLanHost,
    endpoint: () => "wss://example.invalid/temporary",
  });
  assert.equal(await router.fallback!(Error("temporary_room_full")), undefined);
  assert.equal(await router.fallback!(Error("temporary_secure_connection_required")), undefined);
  assert.ok(await router.fallback!(Error("temporary_connection_failed")));
  assert.equal(starts, 1);
});

test("an offline guest with no configured cloud endpoint can create a local room without an account", async () => {
  const route = { url: "wss://127.0.0.1:2345/temporary", certificate: "fixture-only" };
  const router = createTemporaryRoomRouter({
    identity: identity("甲"),
    discovery: {} as TemporaryLanDiscovery,
    host: { start: async () => route } as TemporaryLanHost,
    endpoint: () => "",
  });
  assert.equal(await router.resolve(), route);
});
