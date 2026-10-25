import type { BuiltInAvatarId } from "./settings.types";

export const TEMPORARY_ROOM_PROTOCOL_VERSION = 1;
export const TEMPORARY_ROOM_GRACE_MS = 30_000;
export const TEMPORARY_ROOM_CAPACITY = 5;
export const TEMPORARY_AUTH_AUDIENCE = "shanghao-temporary-v1";

export interface TemporaryRoomProfile {
  nickname: string;
  avatarId?: BuiltInAvatarId;
  /** Already decoded, resized and validated by the local desktop process. */
  avatarDataUrl?: string;
}

export interface TemporaryRoomVersion {
  epoch: number;
  revision: number;
}

export interface TemporaryRoomMember {
  memberId: string;
  deviceId: string;
  publicKey: string;
  profile: TemporaryRoomProfile;
  generation: number;
  joinedAt: number;
  state: "connected" | "disconnected-grace";
  reconnectUntil?: number;
}

export interface TemporaryRoomSnapshot extends TemporaryRoomVersion {
  kind: "temporary";
  sessionId: string;
  code: string;
  authorityId: string;
  adminMemberId: string;
  locked: boolean;
  capacity: 5;
  createdAt: number;
  state: "active" | "reconnecting";
  members: TemporaryRoomMember[];
}

/** Private bearer credential; never include it in a snapshot, discovery packet or log. */
export interface TemporaryMemberTicket {
  sessionId: string;
  memberId: string;
  generation: number;
  token: string;
}

export interface TemporaryRoomAdmission {
  room: TemporaryRoomSnapshot;
  member: TemporaryRoomMember;
  ticket: TemporaryMemberTicket;
}

export interface TemporaryAuthChallenge {
  version: 1;
  audience: string;
  challengeId: string;
  nonce: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
  /** Optional binding to one already resolved room; absent permits room creation. */
  sessionId?: string;
}

export interface TemporaryAuthProof {
  challengeId: string;
  publicKey: string;
  signature: string;
}

export const isTemporaryRoomSessionId = (value: unknown): value is string =>
  typeof value === "string" && /^temp_[a-f0-9]{32}$/.test(value);

/** Fixed-domain transcript shared by the desktop signer and the verifying authority. */
export const temporaryAuthSigningPayload = (challenge: TemporaryAuthChallenge): string =>
  JSON.stringify([
    "shanghao.temporary.device-proof",
    challenge.version,
    challenge.audience,
    challenge.challengeId,
    challenge.nonce,
    challenge.deviceId,
    challenge.issuedAt,
    challenge.expiresAt,
    challenge.sessionId ?? null,
  ]);
