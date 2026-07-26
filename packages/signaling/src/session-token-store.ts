import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_RECONNECT_GRACE_MS = 20_000;

interface SessionTokenRecord {
  roomId: string;
  peerId: string;
  tokenHash: Buffer;
  issuedAt: number;
  expiresAt?: number;
}

export type SessionTokenValidation =
  { status: "valid"; sessionToken: string } | { status: "missing" | "invalid" | "expired" };

const sessionKey = (roomId: string, peerId: string) => `${roomId}:${peerId}`;

const hashToken = (token: string): Buffer => createHash("sha256").update(token, "utf8").digest();

const createToken = (): string => randomBytes(32).toString("base64url");

export class SessionTokenStore {
  private readonly records = new Map<string, SessionTokenRecord>();

  constructor(private readonly reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS) {}

  issue(roomId: string, peerId: string, now = Date.now()): string {
    const sessionToken = createToken();
    this.records.set(sessionKey(roomId, peerId), {
      roomId,
      peerId,
      tokenHash: hashToken(sessionToken),
      issuedAt: now,
    });
    return sessionToken;
  }

  resume(
    roomId: string,
    peerId: string,
    suppliedToken: string | undefined,
    now = Date.now(),
  ): SessionTokenValidation {
    const key = sessionKey(roomId, peerId);
    const record = this.records.get(key);
    if (!record || !suppliedToken) {
      return { status: "missing" };
    }
    if (record.expiresAt !== undefined && now > record.expiresAt) {
      this.records.delete(key);
      return { status: "expired" };
    }

    const suppliedHash = hashToken(suppliedToken);
    if (
      suppliedHash.length !== record.tokenHash.length ||
      !timingSafeEqual(suppliedHash, record.tokenHash)
    ) {
      return { status: "invalid" };
    }

    return {
      status: "valid",
      sessionToken: this.issue(roomId, peerId, now),
    };
  }

  markDisconnected(roomId: string, peerId: string, now = Date.now()): void {
    const record = this.records.get(sessionKey(roomId, peerId));
    if (record) {
      record.expiresAt = now + this.reconnectGraceMs;
    }
  }

  invalidate(roomId: string, peerId: string): void {
    this.records.delete(sessionKey(roomId, peerId));
  }

  clear(): void {
    this.records.clear();
  }
}
