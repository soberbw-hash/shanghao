import { generateKeyPairSync, sign } from "node:crypto";
import {
  TemporaryLanDiscovery,
  lanDeviceId,
  lanAnnouncementSigningPayload,
} from "../../src/main/temporary-lan-discovery";
import { lanElectionVoteSigningPayload } from "../../src/main/temporary-lan-election";
import {
  temporaryCheckpointSigningPayload,
  temporaryReplicaApprovalSigningPayload,
} from "../../../../packages/signaling/src/temporary-room-replica";
import { temporaryAuthSigningPayload } from "../../../../packages/shared/src/types/temporary-room.types";
import { temporaryReplicaStateHeadSigningPayload } from "../../../../packages/signaling/src/temporary-room-state-head";
import { internetRegistrationSigningPayload } from "../../../../packages/signaling/src/temporary-internet-protocol";
import { createTemporaryRoomRouter } from "../../src/main/temporary-room-router";
import type { TemporaryRoomRouter } from "../../src/main/temporary-room-client";
import type {
  TemporaryInternetEndpoint,
  TemporaryInternetRoute,
} from "../../src/main/temporary-internet-connection";
import { TemporaryLanHost, type TemporaryRoomRoute } from "../../src/main/temporary-lan-host";
import { TemporaryRoomClient } from "../../src/main/temporary-room-client";
import type { TemporaryIdentityStore } from "../../src/main/temporary-identity-store";
import { TemporaryInternetProvider } from "../../src/main/temporary-internet-provider";
async function main() {
  const key = generateKeyPairSync("ed25519");
  const publicKey = key.publicKey.export({ format: "pem", type: "spki" }).toString();
  const signature = (payload: string) =>
    sign(null, Buffer.from(payload), key.privateKey).toString("base64url");
  const profile = {
    nickname: "隔离成员",
    avatarId: "fox",
    publicKey,
    deviceId: lanDeviceId(publicKey),
  };
  const identity = {
    getProfile: async () => profile,
    signChallenge: async (c) => ({
      challengeId: c.challengeId,
      publicKey,
      signature: signature(temporaryAuthSigningPayload(c)),
    }),
    signLanAnnouncement: async (payload) => ({
      payload,
      signature: signature(lanAnnouncementSigningPayload(payload)),
    }),
    signElectionVote: async (payload) => ({
      payload,
      signature: signature(lanElectionVoteSigningPayload(payload)),
    }),
    signCheckpoint: async (checkpoint) => ({
      checkpoint,
      signature: signature(temporaryCheckpointSigningPayload(checkpoint)),
    }),
    signReplicaApproval: async (payload) => ({
      payload,
      signature: signature(temporaryReplicaApprovalSigningPayload(payload)),
    }),
    signReplicaStateHead: async (payload) => ({
      payload,
      signature: signature(temporaryReplicaStateHeadSigningPayload(payload)),
    }),
    signInternetRegistration: async (payload) => ({
      payload,
      signature: signature(internetRegistrationSigningPayload(payload)),
    }),
  } satisfies Partial<TemporaryIdentityStore> as TemporaryIdentityStore;
  const discovery = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [],
  });
  const errors: string[] = [];
  const publishProvider = TemporaryInternetProvider.prototype.publish;
  TemporaryInternetProvider.prototype.publish = async function (signed, role, handoff) {
    try {
      return await publishProvider.call(this, signed, role, handoff);
    } catch (error) {
      errors.push(
        `provider_publish:${role}:${signed.payload.epoch}:${signed.payload.revision}:${error instanceof Error ? error.message : "unknown"}`,
      );
      throw error;
    }
  };
  let partitioned = false;
  let forceReplicaTunnel = false,
    replicaTunnels = 0;
  const host = new TemporaryLanHost({
    identity,
    discovery,
    bindAddress: "127.0.0.1",
    onError: (e) => errors.push(e),
  });
  const request = host.replication.request.bind(host.replication);
  // Test-only transport injection simulates NAT: the real private RPC must traverse the broker's inner TLS pipe.
  const routing = host.replication as unknown as {
    peerRoute: (peer: { bridge?: TemporaryInternetRoute }) => Promise<TemporaryRoomRoute>;
  };
  const directRoute = routing.peerRoute.bind(host.replication);
  routing.peerRoute = async (peer) => {
    if (forceReplicaTunnel && peer.bridge) {
      replicaTunnels++;
      return { url: peer.bridge.broker.url, bridge: peer.bridge };
    }
    return directRoute(peer);
  };
  host.replication.request = async (...args) => {
    try {
      if (partitioned) throw Error("temporary_fixture_partition");
      return await request(...args);
    } catch (error) {
      if (error instanceof Error && !/^temporary_[a-z_]+$/.test(error.message))
        process.stderr.write(error.stack ?? error.name);
      throw error;
    }
  };
  const route = await host.start();
  let target: TemporaryRoomRoute = route;
  let internetRouter: TemporaryRoomRouter | undefined;
  const client = new TemporaryRoomClient(identity, () => target.url, undefined, {
    resolve: async (code) => (internetRouter ? internetRouter.resolve(code) : target),
    joined: (r, room) => (internetRouter ? host.joined(r, room) : host.replication.joined(r, room)),
    recover: (room) => host.replication.recover(room),
  });
  let descriptor: Awaited<ReturnType<typeof client.create>>;
  let currentRoom: typeof descriptor.room;
  client.onState((state) => {
    if (state.room) currentRoom = state.room;
  });
  process.on(
    "message",
    async (raw: {
      id: number;
      command: string;
      route?: TemporaryRoomRoute;
      code?: string;
      endpoint?: TemporaryInternetEndpoint;
      forceReplicaTunnel?: boolean;
    }) => {
      try {
        let result: unknown;
        switch (raw.command) {
          case "configure": {
            const endpoint = raw.endpoint!;
            forceReplicaTunnel = raw.forceReplicaTunnel === true;
            internetRouter = createTemporaryRoomRouter({
              identity,
              discovery,
              host,
              endpoint: () => endpoint.url,
              internetEndpoint: () => endpoint,
            });
            result = true;
            break;
          }
          case "create":
            descriptor = await client.create();
            result = descriptor;
            break;
          case "join":
            if (raw.route) target = raw.route;
            descriptor = await client.join(raw.code!);
            result = descriptor;
            break;
          case "recover": {
            const socket = await client.acquire(descriptor.signalingUrl);
            result = {
              open: socket?.readyState === 1,
              room: currentRoom,
              peerId: descriptor.peerId,
              errors,
              replicaTunnels,
            };
            break;
          }
          case "lock":
            result = await client.manage({
              contextId: descriptor.contextId,
              action: "lock",
              expected: currentRoom,
              locked: true,
            });
            break;
          case "rotate":
            result = await client.manage({
              contextId: descriptor.contextId,
              action: "rotate",
              expected: currentRoom,
            });
            break;
          case "partition":
            partitioned = true;
            result = true;
            break;
          case "disconnect":
            (await client.acquire(descriptor.signalingUrl))?.terminate();
            result = true;
            break;
          case "state":
            result = currentRoom;
            break;
          case "diagnostics":
            result = errors;
            break;
          case "close":
            client.close();
            await host.close();
            await discovery.stop();
            result = true;
            break;
          default:
            throw Error("fixture_command_invalid");
        }
        process.send?.({ id: raw.id, result });
      } catch (error) {
        process.send?.({
          id: raw.id,
          error: error instanceof Error ? error.message : "fixture_error",
          errors,
        });
      }
    },
  );
  process.send?.({ ready: true, route, deviceId: profile.deviceId });
}
void main().catch(() => (process.exitCode = 1));
