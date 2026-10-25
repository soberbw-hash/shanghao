import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import {
  TEMPORARY_AUTH_AUDIENCE,
  temporaryAuthSigningPayload,
  type TemporaryAuthChallenge,
  type TemporaryAuthProof,
} from "../../shared/src/types/temporary-room.types";

export { temporaryAuthSigningPayload } from "../../shared/src/types/temporary-room.types";

const verifiedPrincipals = new WeakSet<object>();

/** Only instances returned by a successful proof verification are accepted by the coordinator. */
export interface VerifiedTemporaryPrincipal {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly audience: string;
  readonly sessionId?: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export const assertVerifiedTemporaryPrincipal = (
  principal: VerifiedTemporaryPrincipal,
  audience: string,
  now: number,
  sessionId?: string,
): void => {
  if (!principal || !verifiedPrincipals.has(principal))
    throw new Error("temporary_identity_unverified");
  if (
    principal.audience !== audience ||
    now >= principal.expiresAt ||
    now < principal.issuedAt ||
    (principal.sessionId !== undefined && principal.sessionId !== sessionId)
  )
    throw new Error("temporary_identity_mismatch");
};

interface ChallengeRecord {
  challenge: TemporaryAuthChallenge;
  publicKey: string;
}

export interface TemporaryRoomAuthOptions {
  audience?: string;
  now?: () => number;
  challengeTtlMs?: number;
  maxPending?: number;
  maxPendingPerDevice?: number;
}

const boundedOption = (value: number | undefined, fallback: number, maximum: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error("temporary_auth_configuration_invalid");
  return value;
};

const deviceKey = (value: string): { deviceId: string; publicKey: string } => {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
    const der = key.export({ type: "spki", format: "der" });
    return {
      deviceId: `device_${createHash("sha256").update(der).digest("base64url")}`,
      publicKey: key.export({ type: "spki", format: "pem" }).toString(),
    };
  } catch {
    throw new Error("temporary_public_key_invalid");
  }
};

/** No account database dependency. Device proof authenticates an installation, not a person. */
export class TemporaryRoomAuthenticator {
  private readonly pending = new Map<string, ChallengeRecord>();
  private readonly now: () => number;
  private readonly audience: string;
  private readonly ttlMs: number;
  private readonly maxPending: number;
  private readonly perDevice: number;

  constructor(options: TemporaryRoomAuthOptions = {}) {
    this.now = options.now ?? Date.now;
    this.audience = options.audience ?? TEMPORARY_AUTH_AUDIENCE;
    if (!this.audience || this.audience.length > 160)
      throw new Error("temporary_auth_configuration_invalid");
    this.ttlMs = boundedOption(options.challengeTtlMs, 30_000, 120_000);
    this.maxPending = boundedOption(options.maxPending, 2048, 100_000);
    this.perDevice = boundedOption(options.maxPendingPerDevice, 4, 32);
  }

  issueChallenge(input: { publicKey: string; sessionId?: string }): TemporaryAuthChallenge {
    const { deviceId, publicKey } = deviceKey(input?.publicKey);
    if (
      input.sessionId !== undefined &&
      (typeof input.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.sessionId))
    )
      throw new Error("temporary_session_invalid");
    const now = this.now();
    this.sweep(now);
    let devicePending = 0;
    for (const record of this.pending.values())
      if (record.challenge.deviceId === deviceId) devicePending += 1;
    if (this.pending.size >= this.maxPending || devicePending >= this.perDevice)
      throw new Error("temporary_challenge_capacity");
    const challenge: TemporaryAuthChallenge = {
      version: 1,
      audience: this.audience,
      challengeId: randomUUID(),
      nonce: randomBytes(32).toString("base64url"),
      deviceId,
      issuedAt: now,
      expiresAt: now + this.ttlMs,
      sessionId: input.sessionId,
    };
    this.pending.set(challenge.challengeId, { challenge, publicKey });
    return { ...challenge };
  }

  verify(proof: TemporaryAuthProof): VerifiedTemporaryPrincipal {
    const id = proof?.challengeId;
    const record = typeof id === "string" && id.length <= 64 ? this.pending.get(id) : undefined;
    // Consume before parsing or verifying: a failed attempt must not become an online oracle.
    if (record) this.pending.delete(id);
    const now = this.now();
    if (!record || now >= record.challenge.expiresAt || now < record.challenge.issuedAt)
      throw new Error("temporary_challenge_invalid");
    try {
      const key = deviceKey(proof.publicKey);
      if (
        key.deviceId !== record.challenge.deviceId ||
        key.publicKey !== record.publicKey ||
        typeof proof.signature !== "string" ||
        !/^[A-Za-z0-9_-]{86}$/.test(proof.signature)
      )
        throw new Error();
      if (
        !verify(
          null,
          Buffer.from(temporaryAuthSigningPayload(record.challenge)),
          record.publicKey,
          Buffer.from(proof.signature, "base64url"),
        )
      )
        throw new Error();
    } catch {
      throw new Error("temporary_proof_invalid");
    }
    const principal = Object.freeze({
      deviceId: record.challenge.deviceId,
      publicKey: record.publicKey,
      audience: record.challenge.audience,
      sessionId: record.challenge.sessionId,
      issuedAt: record.challenge.issuedAt,
      expiresAt: record.challenge.expiresAt,
    });
    verifiedPrincipals.add(principal);
    return principal;
  }

  sweep(now = this.now()): void {
    for (const [id, record] of this.pending)
      if (now >= record.challenge.expiresAt) this.pending.delete(id);
  }

  clear(): void {
    this.pending.clear();
  }
}
