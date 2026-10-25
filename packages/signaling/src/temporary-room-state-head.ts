import { createHash, createPublicKey, verify } from "node:crypto";
import { isTemporaryRoomSessionId } from "../../shared/src/types/temporary-room.types";
export interface TemporaryReplicaStateHead {
  version: 1;
  sessionId: string;
  authorityId: string;
  epoch: number;
  revision: number;
  sequence: number;
  checkpointDigest: string;
  membershipDigest: string;
  terminal: boolean;
  issuedAt: number;
  expiresAt: number;
}
export interface SignedTemporaryReplicaStateHead {
  payload: TemporaryReplicaStateHead;
  signature: string;
}
/** Fixed private WSS domain, including a monotonic fence for a member removed from the full replica. */
export const temporaryReplicaStateHeadSigningPayload = (p: TemporaryReplicaStateHead): string =>
  JSON.stringify([
    "shanghao.temporary.replica-state-head",
    p.version,
    p.sessionId,
    p.authorityId,
    p.epoch,
    p.revision,
    p.sequence,
    p.checkpointDigest,
    p.membershipDigest,
    p.terminal,
    p.issuedAt,
    p.expiresAt,
  ]);
export function verifyTemporaryReplicaStateHead(
  value: SignedTemporaryReplicaStateHead,
  publicKey: string,
  now = Date.now(),
): boolean {
  try {
    const p = value?.payload,
      key = createPublicKey(publicKey);
    return Boolean(
      p &&
      p.version === 1 &&
      isTemporaryRoomSessionId(p.sessionId) &&
      key.asymmetricKeyType === "ed25519" &&
      p.authorityId ===
        "device_" +
          createHash("sha256")
            .update(key.export({ type: "spki", format: "der" }))
            .digest("base64url") &&
      [p.epoch, p.sequence].every((n) => Number.isSafeInteger(n) && n > 0) &&
      Number.isSafeInteger(p.revision) &&
      p.revision >= 0 &&
      [p.checkpointDigest, p.membershipDigest].every(
        (x) => typeof x === "string" && /^[A-Za-z0-9_-]{43}$/.test(x),
      ) &&
      typeof p.terminal === "boolean" &&
      Number.isSafeInteger(p.issuedAt) &&
      Number.isSafeInteger(p.expiresAt) &&
      p.issuedAt <= now + 200 &&
      p.expiresAt > now &&
      p.expiresAt - p.issuedAt <= 30_000 &&
      typeof value.signature === "string" &&
      /^[A-Za-z0-9_-]{86}$/.test(value.signature) &&
      verify(
        null,
        Buffer.from(temporaryReplicaStateHeadSigningPayload(p)),
        key,
        Buffer.from(value.signature, "base64url"),
      ),
    );
  } catch {
    return false;
  }
}
