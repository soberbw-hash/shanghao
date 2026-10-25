import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { nativeImage, safeStorage } from "electron";
import { isBuiltInAvatarId } from "../../../../packages/shared/src/constants/profile";
import {
  isTemporaryRoomSessionId,
  temporaryAuthSigningPayload,
  type TemporaryAuthChallenge,
  type TemporaryAuthProof,
  type TemporaryRoomProfile,
} from "../../../../packages/shared/src/types/temporary-room.types";
import { isValidNickname } from "../../../../packages/signaling/src/protocol";
import { writePrivateFileAtomically } from "./atomic-private-file";
import {
  internetRegistrationSigningPayload,
  verifyInternetRegistration,
  type TemporaryInternetRegistration,
  type SignedInternetRegistration,
} from "../../../../packages/signaling/src/temporary-internet-protocol";
import {
  temporaryReplicaStateHeadSigningPayload,
  verifyTemporaryReplicaStateHead,
  type TemporaryReplicaStateHead,
  type SignedTemporaryReplicaStateHead,
} from "../../../../packages/signaling/src/temporary-room-state-head";
import {
  temporaryCheckpointSigningPayload,
  temporaryReplicaApprovalSigningPayload,
  type TemporaryCoordinatorCheckpoint,
  type SignedTemporaryCheckpoint,
  type TemporaryReplicaApproval,
  type SignedTemporaryReplicaApproval,
} from "../../../../packages/signaling/src/temporary-room-replica";
import {
  lanAnnouncementSigningPayload,
  verifyLanRoomAnnouncement,
  type LanRoomAnnouncementPayload,
  type SignedLanRoomAnnouncement,
} from "./temporary-lan-discovery";
import {
  lanElectionVoteSigningPayload,
  type LanElectionVotePayload,
  type SignedLanElectionVote,
} from "./temporary-lan-election";

export interface TemporaryIdentitySecureStorage {
  isEncryptionAvailable(): boolean | Promise<boolean>;
  encrypt(plaintext: string): Buffer | Promise<Buffer>;
  decrypt(bytes: Buffer): Promise<{ plaintext: string; shouldReencrypt?: boolean }>;
}

export interface TemporaryLocalProfile extends TemporaryRoomProfile {
  version: 1;
  deviceId: string;
  publicKey: string;
}

interface StoredIdentity {
  version: 1;
  publicProfile: TemporaryLocalProfile;
  privateKeyPkcs8: string;
}

export interface TemporaryIdentityStoreOptions {
  secureStorage?: TemporaryIdentitySecureStorage;
  now?: () => number;
  /** Main-only image decoder adapter; callers never receive private-key material. */
  normalizeAvatar?: (dataUrl: string) => string | Promise<string>;
}

const storage: TemporaryIdentitySecureStorage = {
  isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptStringAsync(plain),
  decrypt: async (bytes) => {
    const result = await safeStorage.decryptStringAsync(bytes);
    return { plaintext: result.result, shouldReencrypt: result.shouldReEncrypt };
  },
};

const identityForPublicKey = (publicKey: string): string =>
  `device_${createHash("sha256")
    .update(createPublicKey(publicKey).export({ type: "spki", format: "der" }))
    .digest("base64url")}`;

/** Checks encoded dimensions before native decode, including images with tiny compressed payloads. */
const avatarBytes = (dataUrl: string): { bytes: Buffer; width: number; height: number } => {
  if (typeof dataUrl !== "string" || dataUrl.length > 180_000) throw new Error();
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw new Error();
  const bytes = Buffer.from(match[2]!, "base64");
  let width = 0;
  let height = 0;
  if (
    match[1] === "png" &&
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (match[1] === "jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      offset += length + 2;
    }
  } else if (
    match[1] === "webp" &&
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    const type = bytes.toString("ascii", 12, 16);
    if (type === "VP8X") {
      width = bytes.readUIntLE(24, 3) + 1;
      height = bytes.readUIntLE(27, 3) + 1;
    } else if (type === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = bytes.readUInt16LE(26) & 16383;
      height = bytes.readUInt16LE(28) & 16383;
    } else if (type === "VP8L" && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    }
  }
  if (!width || !height || width > 4096 || height > 4096 || width * height > 4_194_304)
    throw new Error();
  return { bytes, width, height };
};

export const normalizeTemporaryAvatar = (dataUrl: string): string => {
  avatarBytes(dataUrl);
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error();
  const { width, height } = image.getSize();
  const edge = Math.min(width, height);
  const encoded = image
    .crop({
      x: Math.floor((width - edge) / 2),
      y: Math.floor((height - edge) / 2),
      width: edge,
      height: edge,
    })
    .resize({ width: 128, height: 128, quality: "good" })
    .toJPEG(82);
  if (encoded.length > 24 * 1024) throw Error("temporary_avatar_too_large");
  return `data:image/jpeg;base64,${encoded.toString("base64")}`;
};

/** Separate encrypted identity file; never reads or rewrites account sessions or settings. */
export class TemporaryIdentityStore {
  private readonly file: string;
  private readonly secure: TemporaryIdentitySecureStorage;
  private readonly now: () => number;
  private readonly normalizeAvatar: (dataUrl: string) => string | Promise<string>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly signedChallenges = new Map<string, number>();

  constructor(userDataDirectory: string, options: TemporaryIdentityStoreOptions = {}) {
    this.file = path.join(userDataDirectory, "temporary-identity.bin");
    this.secure = options.secureStorage ?? storage;
    this.now = options.now ?? Date.now;
    this.normalizeAvatar = options.normalizeAvatar ?? normalizeTemporaryAvatar;
  }

  getProfile(): Promise<TemporaryLocalProfile | undefined> {
    return this.serialize(async () => {
      const state = await this.readState();
      return state ? { ...state.publicProfile } : undefined;
    });
  }

  saveProfile(input: TemporaryRoomProfile): Promise<TemporaryLocalProfile> {
    return this.serialize(async () => {
      const profile = await this.validateProfile(input, true);
      const existing = await this.readState();
      let state: StoredIdentity;
      if (existing)
        state = { ...existing, publicProfile: { ...existing.publicProfile, ...profile } };
      else {
        const keys = generateKeyPairSync("ed25519");
        const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
        state = {
          version: 1,
          publicProfile: {
            ...profile,
            version: 1,
            deviceId: identityForPublicKey(publicKey),
            publicKey,
          },
          privateKeyPkcs8: keys.privateKey
            .export({ type: "pkcs8", format: "der" })
            .toString("base64"),
        };
      }
      await this.writeState(state);
      return { ...state.publicProfile };
    });
  }

  signChallenge(
    challenge: TemporaryAuthChallenge,
    expected: { audience: string; sessionId?: string },
  ): Promise<TemporaryAuthProof> {
    return this.serialize(async () => {
      const state = await this.readState();
      if (!state) throw new Error("temporary_profile_required");
      const now = this.now();
      if (
        !challenge ||
        typeof challenge !== "object" ||
        challenge.version !== 1 ||
        typeof expected?.audience !== "string" ||
        !expected.audience ||
        expected.audience.length > 160 ||
        challenge.audience !== expected.audience ||
        challenge.sessionId !== expected.sessionId ||
        (challenge.sessionId !== undefined && !isTemporaryRoomSessionId(challenge.sessionId)) ||
        challenge.deviceId !== state.publicProfile.deviceId ||
        typeof challenge.challengeId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(challenge.challengeId) ||
        typeof challenge.nonce !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce) ||
        !Number.isSafeInteger(challenge.issuedAt) ||
        !Number.isSafeInteger(challenge.expiresAt) ||
        challenge.issuedAt > now + 5000 ||
        challenge.issuedAt < now - 120_000 ||
        challenge.expiresAt <= now ||
        challenge.expiresAt <= challenge.issuedAt ||
        challenge.expiresAt - challenge.issuedAt > 120_000
      )
        throw new Error("temporary_challenge_invalid");
      for (const [id, expires] of this.signedChallenges)
        if (expires <= now) this.signedChallenges.delete(id);
      const key = `${challenge.audience}:${challenge.challengeId}`;
      if (this.signedChallenges.has(key)) throw new Error("temporary_challenge_replayed");
      if (this.signedChallenges.size >= 512) throw new Error("temporary_challenge_capacity");
      const privateKey = createPrivateKey({
        key: Buffer.from(state.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const signature = sign(
        null,
        Buffer.from(temporaryAuthSigningPayload(challenge)),
        privateKey,
      ).toString("base64url");
      this.signedChallenges.set(key, challenge.expiresAt);
      return {
        challengeId: challenge.challengeId,
        publicKey: state.publicProfile.publicKey,
        signature,
      };
    });
  }

  /** Main-only fixed-domain signer; never exposed as a generic renderer signing API. */
  signLanAnnouncement(payload: LanRoomAnnouncementPayload): Promise<SignedLanRoomAnnouncement> {
    return this.serialize(async () => {
      const state = await this.readState();
      if (
        !state ||
        payload?.authorityId !== state.publicProfile.deviceId ||
        payload.publicKey !== state.publicProfile.publicKey
      )
        throw Error("temporary_lan_identity_invalid");
      const key = createPrivateKey({
        key: Buffer.from(state.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const signed = {
        payload,
        signature: sign(null, Buffer.from(lanAnnouncementSigningPayload(payload)), key).toString(
          "base64url",
        ),
      };
      const validated = verifyLanRoomAnnouncement(signed, this.now());
      if (!validated) throw Error("temporary_lan_announcement_invalid");
      return validated;
    });
  }

  signElectionVote(
    payload: LanElectionVotePayload,
    expected: { sessionId: string; membershipDigest: string },
  ): Promise<SignedLanElectionVote> {
    return this.serialize(async () => {
      const state = await this.readState(),
        now = this.now();
      if (
        !state ||
        payload?.voterId !== state.publicProfile.deviceId ||
        !isTemporaryRoomSessionId(expected.sessionId) ||
        payload.sessionId !== expected.sessionId ||
        payload.membershipDigest !== expected.membershipDigest ||
        payload.version !== 1 ||
        payload.epoch !== payload.previousEpoch + 1 ||
        !Number.isSafeInteger(payload.epoch) ||
        payload.epoch < 2 ||
        !/^device_[A-Za-z0-9_-]{43}$/.test(payload.candidateId) ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.proposalId) ||
        !/^[A-Za-z0-9_-]{43}$/.test(payload.proposalDigest) ||
        !Number.isSafeInteger(payload.issuedAt) ||
        !Number.isSafeInteger(payload.expiresAt) ||
        payload.issuedAt > now + 5000 ||
        payload.expiresAt <= now ||
        payload.expiresAt - payload.issuedAt > 30_000
      )
        throw Error("temporary_lan_vote_invalid");
      const key = createPrivateKey({
        key: Buffer.from(state.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      return {
        payload,
        signature: sign(null, Buffer.from(lanElectionVoteSigningPayload(payload)), key).toString(
          "base64url",
        ),
      };
    });
  }

  /** Called only by the owned local coordinator, with a fixed private replication domain. */
  signCheckpoint(checkpoint: TemporaryCoordinatorCheckpoint): Promise<SignedTemporaryCheckpoint> {
    return this.serialize(async () => {
      const state = await this.readState();
      const now = this.now();
      if (
        !state ||
        checkpoint.authorityId !== state.publicProfile.deviceId ||
        !isTemporaryRoomSessionId(checkpoint.sessionId) ||
        checkpoint.version !== 1 ||
        checkpoint.exportedAt > now + 200 ||
        checkpoint.expiresAt <= now ||
        checkpoint.expiresAt - checkpoint.exportedAt > 30_000
      )
        throw Error("temporary_checkpoint_invalid");
      const key = createPrivateKey({
        key: Buffer.from(state.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      return {
        checkpoint,
        signature: sign(
          null,
          Buffer.from(temporaryCheckpointSigningPayload(checkpoint)),
          key,
        ).toString("base64url"),
      };
    });
  }

  signReplicaApproval(payload: TemporaryReplicaApproval): Promise<SignedTemporaryReplicaApproval> {
    return this.serialize(async () => {
      const state = await this.readState();
      const now = this.now();
      if (
        !state ||
        payload.voterId !== state.publicProfile.deviceId ||
        !isTemporaryRoomSessionId(payload.sessionId) ||
        payload.version !== 1 ||
        payload.toEpoch !== payload.fromEpoch + 1 ||
        payload.issuedAt > now + 200 ||
        payload.expiresAt <= now ||
        payload.expiresAt - payload.issuedAt > 10_000 ||
        ![payload.checkpointDigest, payload.membershipDigest, payload.electionProposalDigest].every(
          (x) => /^[A-Za-z0-9_-]{43}$/.test(x),
        )
      )
        throw Error("temporary_replica_approval_invalid");
      const key = createPrivateKey({
        key: Buffer.from(state.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      return {
        payload,
        signature: sign(
          null,
          Buffer.from(temporaryReplicaApprovalSigningPayload(payload)),
          key,
        ).toString("base64url"),
      };
    });
  }

  signReplicaStateHead(
    payload: TemporaryReplicaStateHead,
  ): Promise<SignedTemporaryReplicaStateHead> {
    return this.serialize(async () => {
      const state = await this.readState();
      if (!state || payload?.authorityId !== state.publicProfile.deviceId)
        throw Error("temporary_replica_head_invalid");
      const key = createPrivateKey({
        key: Buffer.from(state.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const value = {
        payload,
        signature: sign(
          null,
          Buffer.from(temporaryReplicaStateHeadSigningPayload(payload)),
          key,
        ).toString("base64url"),
      };
      if (!verifyTemporaryReplicaStateHead(value, state.publicProfile.publicKey, this.now()))
        throw Error("temporary_replica_head_invalid");
      return value;
    });
  }

  signInternetRegistration(
    payload: TemporaryInternetRegistration,
  ): Promise<SignedInternetRegistration> {
    return this.serialize(async () => {
      const state = await this.readState();
      if (
        !state ||
        payload?.authorityId !== state.publicProfile.deviceId ||
        payload.publicKey !== state.publicProfile.publicKey
      )
        throw Error("temporary_bridge_registration_invalid");
      const key = createPrivateKey({
        key: Buffer.from(state.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const signed = {
        payload,
        signature: sign(
          null,
          Buffer.from(internetRegistrationSigningPayload(payload)),
          key,
        ).toString("base64url"),
      };
      if (!verifyInternetRegistration(signed, this.now()))
        throw Error("temporary_bridge_registration_invalid");
      return signed;
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation, operation);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async validateProfile(
    input: TemporaryRoomProfile,
    normalize: boolean,
  ): Promise<TemporaryRoomProfile> {
    if (
      !input ||
      !isValidNickname(input.nickname) ||
      (input.avatarId !== undefined && !isBuiltInAvatarId(input.avatarId))
    )
      throw new Error("temporary_profile_invalid");
    let avatarDataUrl: string | undefined;
    try {
      if (input.avatarDataUrl !== undefined) {
        avatarBytes(input.avatarDataUrl);
        avatarDataUrl = normalize
          ? await this.normalizeAvatar(input.avatarDataUrl)
          : input.avatarDataUrl;
        const normalized = avatarBytes(avatarDataUrl);
        if (normalized.width > 128 || normalized.height > 128) throw new Error();
      }
    } catch {
      throw new Error("temporary_profile_invalid");
    }
    return { nickname: input.nickname, avatarId: input.avatarId, avatarDataUrl };
  }

  private async readState(): Promise<StoredIdentity | undefined> {
    let bytes: Buffer;
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 || info.size === 0)
        throw new Error("temporary_identity_invalid");
      bytes = await readFile(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!(await this.secure.isEncryptionAvailable()))
      throw new Error("temporary_secure_storage_unavailable");
    const decrypted = await this.secure.decrypt(bytes);
    try {
      const state = JSON.parse(decrypted.plaintext) as StoredIdentity;
      if (
        state.version !== 1 ||
        state.publicProfile?.version !== 1 ||
        typeof state.privateKeyPkcs8 !== "string" ||
        state.privateKeyPkcs8.length > 256 ||
        typeof state.publicProfile.publicKey !== "string" ||
        state.publicProfile.publicKey.length > 512
      )
        throw new Error();
      const key = createPrivateKey({
        key: Buffer.from(state.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      });
      const publicKey = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
      if (
        key.asymmetricKeyType !== "ed25519" ||
        publicKey !== state.publicProfile.publicKey ||
        identityForPublicKey(publicKey) !== state.publicProfile.deviceId
      )
        throw new Error();
      const profile = await this.validateProfile(state.publicProfile, false);
      state.publicProfile = {
        ...profile,
        version: 1,
        deviceId: identityForPublicKey(publicKey),
        publicKey,
      };
      if (decrypted.shouldReencrypt) await this.writeState(state);
      return state;
    } catch {
      throw new Error("temporary_identity_invalid");
    }
  }

  private async writeState(state: StoredIdentity): Promise<void> {
    if (!(await this.secure.isEncryptionAvailable()))
      throw new Error("temporary_secure_storage_unavailable");
    await writePrivateFileAtomically(this.file, await this.secure.encrypt(JSON.stringify(state)));
  }
}
