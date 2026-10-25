import { generateKeyPairSync, sign } from "node:crypto";
import { lanDeviceId, lanAnnouncementSigningPayload } from "../../src/main/temporary-lan-discovery";
import { lanElectionVoteSigningPayload } from "../../src/main/temporary-lan-election";
import { temporaryAuthSigningPayload } from "../../../../packages/shared/src/types/temporary-room.types";
import {
  temporaryCheckpointSigningPayload,
  temporaryReplicaApprovalSigningPayload,
} from "../../../../packages/signaling/src/temporary-room-replica";
import { temporaryReplicaStateHeadSigningPayload } from "../../../../packages/signaling/src/temporary-room-state-head";
import { internetRegistrationSigningPayload } from "../../../../packages/signaling/src/temporary-internet-protocol";
import type { TemporaryIdentityStore } from "../../src/main/temporary-identity-store";
export function temporaryTestIdentity(nickname = "隔离成员"): TemporaryIdentityStore {
  const key = generateKeyPairSync("ed25519"),
    publicKey = key.publicKey.export({ format: "pem", type: "spki" }).toString();
  const signature = (payload: string) =>
    sign(null, Buffer.from(payload), key.privateKey).toString("base64url");
  return {
    getProfile: async () => ({
      nickname,
      avatarId: "fox",
      deviceId: lanDeviceId(publicKey),
      publicKey,
    }),
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
}
