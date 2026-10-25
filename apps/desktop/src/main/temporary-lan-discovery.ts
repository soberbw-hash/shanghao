import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { createSocket, type Socket, type RemoteInfo } from "node:dgram";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { isIPv4 } from "node:net";
import { isTemporaryRoomSessionId } from "../../../../packages/shared/src/types/temporary-room.types";
import { normalizeTemporaryRoomCode } from "../../../../packages/shared/src/utils/temporary-room-code";

export interface LanRoomAnnouncementPayload {
  protocol: 1;
  type: "announcement";
  authorityId: string;
  publicKey: string;
  sessionId: string;
  epoch: number;
  port: number;
  certificateSha256: string;
  discoveryId: string;
  issuedAt: number;
  expiresAt: number;
}
export interface SignedLanRoomAnnouncement {
  payload: LanRoomAnnouncementPayload;
  signature: string;
}
export interface LanRoomEndpoint extends LanRoomAnnouncementPayload {
  address: string;
  endpoint: string;
  signature: string;
}

/** Fixed domain and field order; suitable only for a dedicated Main signLanAnnouncement API. */
export const lanAnnouncementSigningPayload = (p: LanRoomAnnouncementPayload): string =>
  JSON.stringify([
    "shanghao.lan.announcement",
    p.protocol,
    p.type,
    p.authorityId,
    p.publicKey,
    p.sessionId,
    p.epoch,
    p.port,
    p.certificateSha256,
    p.discoveryId,
    p.issuedAt,
    p.expiresAt,
  ]);

export const lanDeviceId = (publicKey: string): string => {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("temporary_lan_key_invalid");
  return `device_${createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("base64url")}`;
};

/** A signed self-announcement binds the TLS pin to the device; it is not a room admission grant. */
export const verifyLanRoomAnnouncement = (
  value: unknown,
  now = Date.now(),
): SignedLanRoomAnnouncement | undefined => {
  try {
    if (!value || typeof value !== "object") return undefined;
    const signed = value as SignedLanRoomAnnouncement;
    const p = signed.payload;
    if (
      !p ||
      p.protocol !== 1 ||
      p.type !== "announcement" ||
      !isTemporaryRoomSessionId(p.sessionId) ||
      typeof p.publicKey !== "string" ||
      p.publicKey.length > 512 ||
      typeof p.authorityId !== "string" ||
      !/^device_[A-Za-z0-9_-]{43}$/.test(p.authorityId) ||
      !Number.isSafeInteger(p.epoch) ||
      p.epoch < 1 ||
      !Number.isSafeInteger(p.port) ||
      p.port < 1 ||
      p.port > 65535 ||
      typeof p.certificateSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(p.certificateSha256) ||
      typeof p.discoveryId !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(p.discoveryId) ||
      !Number.isSafeInteger(p.issuedAt) ||
      !Number.isSafeInteger(p.expiresAt) ||
      p.issuedAt > now + 2000 ||
      p.expiresAt <= now ||
      p.expiresAt <= p.issuedAt ||
      p.expiresAt - p.issuedAt > 15_000 ||
      p.authorityId !== lanDeviceId(p.publicKey) ||
      typeof signed.signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(signed.signature)
    )
      return undefined;
    if (
      !verify(
        null,
        Buffer.from(lanAnnouncementSigningPayload(p)),
        p.publicKey,
        Buffer.from(signed.signature, "base64url"),
      )
    )
      return undefined;
    // Copy an explicit allowlist; accidentally attached code/tickets never enter a datagram.
    return {
      payload: {
        protocol: 1,
        type: "announcement",
        authorityId: p.authorityId,
        publicKey: p.publicKey,
        sessionId: p.sessionId,
        epoch: p.epoch,
        port: p.port,
        certificateSha256: p.certificateSha256,
        discoveryId: p.discoveryId,
        issuedAt: p.issuedAt,
        expiresAt: p.expiresAt,
      },
      signature: signed.signature,
    };
  } catch {
    return undefined;
  }
};

export interface LanBroadcastTarget {
  address: string;
  port: number;
}
export const lanBroadcastTargets = (
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces(),
  port = 43824,
): LanBroadcastTarget[] => {
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces))
    for (const info of entries ?? []) {
      if (info.internal || info.family !== "IPv4" || !isIPv4(info.address) || !isIPv4(info.netmask))
        continue;
      const ip = info.address.split(".").map(Number);
      const mask = info.netmask.split(".").map(Number);
      addresses.add(ip.map((part, index) => part | (255 - mask[index]!)).join("."));
    }
  return [...addresses].map((address) => ({ address, port }));
};

export interface TemporaryLanDiscoveryOptions {
  bindAddress?: string;
  port?: number;
  targets?: LanBroadcastTarget[];
  allowLoopback?: boolean;
  now?: () => number;
  socketFactory?: () => Socket;
  responsesPerSecond?: number;
  /** Bounded public metadata only; no room code or admission credentials are emitted. */
  onPacket?: (serialized: string) => void;
}
interface PendingQuery {
  finish(error?: Error): void;
}
interface RateWindow {
  at: number;
  count: number;
}

const cancellable = async <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) throw new Error("temporary_discovery_cancelled");
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new Error("temporary_discovery_cancelled"));
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      }),
    ]);
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
  }
};

const localAddress = (address: string, allowLoopback = false): boolean =>
  isIPv4(address) &&
  (address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    (address.startsWith("172.") &&
      Number(address.split(".")[1]) >= 16 &&
      Number(address.split(".")[1]) <= 31) ||
    address.startsWith("169.254.") ||
    (allowLoopback && address.startsWith("127.")));

/** Owns one UDP socket; code resolution must use a separately authenticated, exactly pinned WSS connection. */
export class TemporaryLanDiscovery {
  private socket?: Socket;
  private opening?: Promise<{ address: string; port: number }>;
  private closed = false;
  private readonly published = new Map<string, SignedLanRoomAnnouncement>();
  private readonly endpoints = new Map<string, LanRoomEndpoint>();
  private readonly pending = new Map<string, PendingQuery>();
  private readonly lookups = new Set<AbortController>();
  private readonly rates = new Map<string, RateWindow>();
  private readonly inboundRates = new Map<string, RateWindow>();
  private droppedPackets = 0;
  private readonly now: () => number;
  private readonly responseLimit: number;

  constructor(private readonly options: TemporaryLanDiscoveryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.responseLimit = options.responsesPerSecond ?? 4;
    if (
      !Number.isSafeInteger(this.responseLimit) ||
      this.responseLimit < 1 ||
      this.responseLimit > 32 ||
      (options.port !== undefined &&
        (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535))
    )
      throw new Error("temporary_lan_configuration_invalid");
  }

  start(): Promise<{ address: string; port: number }> {
    if (this.closed) return Promise.reject(new Error("temporary_discovery_closed"));
    if (this.opening) return this.opening;
    if (this.socket) {
      const address = this.socket.address();
      return Promise.resolve({ address: address.address, port: address.port });
    }
    const socket =
      this.options.socketFactory?.() ?? createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("message", (bytes, remote) => this.receive(bytes, remote));
    socket.on("error", () => {
      this.droppedPackets += 1;
    });
    this.opening = new Promise<{ address: string; port: number }>((resolve, reject) => {
      const failed = () => {
        this.socket = undefined;
        try {
          socket.close();
        } catch {
          /* A failed bind may already have closed it. */
        }
        reject(new Error("temporary_discovery_bind_failed"));
      };
      socket.once("error", failed);
      socket.bind(this.options.port ?? 43824, this.options.bindAddress ?? "0.0.0.0", () => {
        socket.off("error", failed);
        if (this.closed) {
          reject(new Error("temporary_discovery_closed"));
          return;
        }
        try {
          socket.setBroadcast(true);
        } catch {
          failed();
          return;
        }
        const address = socket.address();
        resolve({ address: address.address, port: address.port });
      });
    }).finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  publish(value: SignedLanRoomAnnouncement): void {
    if (!this.socket || this.closed) throw new Error("temporary_discovery_closed");
    const signed = verifyLanRoomAnnouncement(value, this.now());
    if (!signed) throw new Error("temporary_lan_announcement_invalid");
    this.prune();
    const key = `${signed.payload.sessionId}:${signed.payload.authorityId}`;
    if (!this.published.has(key) && this.published.size >= 16)
      throw new Error("temporary_discovery_capacity");
    const old = this.published.get(key)?.payload;
    if (old && (signed.payload.epoch < old.epoch || signed.payload.issuedAt < old.issuedAt))
      throw new Error("temporary_lan_stale_announcement");
    this.published.set(key, signed);
    for (const target of this.targets()) this.send({ ...signed }, target);
  }

  unpublish(sessionId: string): void {
    for (const [key, value] of this.published)
      if (value.payload.sessionId === sessionId) this.published.delete(key);
  }

  discover(input: { durationMs?: number; signal?: AbortSignal } = {}): Promise<LanRoomEndpoint[]> {
    if (!this.socket || this.closed) return Promise.reject(new Error("temporary_discovery_closed"));
    if (input.signal?.aborted) return Promise.reject(new Error("temporary_discovery_cancelled"));
    const duration = input.durationMs ?? 500;
    if (!Number.isInteger(duration) || duration < 10 || duration > 5000 || this.pending.size >= 4)
      return Promise.reject(new Error("temporary_discovery_capacity"));
    this.prune();
    const nonce = randomBytes(32).toString("base64url");
    return new Promise((resolve, reject) => {
      const aborted = () => finish(new Error("temporary_discovery_cancelled"));
      const timer = setTimeout(() => finish(), duration);
      const finish = (error?: Error) => {
        if (!this.pending.delete(nonce)) return;
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", aborted);
        this.prune();
        if (error) reject(error);
        else resolve(this.snapshot());
      };
      this.pending.set(nonce, { finish });
      input.signal?.addEventListener("abort", aborted, { once: true });
      for (const target of this.targets()) this.send({ protocol: 1, type: "probe", nonce }, target);
    });
  }

  async lookup(
    value: string,
    resolveAuthenticated: (
      endpoint: LanRoomEndpoint,
      code: string,
      signal?: AbortSignal,
    ) => Promise<{ sessionId: string; authorityId: string; epoch: number } | undefined>,
    input: { durationMs?: number; signal?: AbortSignal; resolverTimeoutMs?: number } = {},
  ): Promise<LanRoomEndpoint> {
    const code = normalizeTemporaryRoomCode(value);
    if (!code) throw new Error("temporary_room_code_invalid");
    if (this.lookups.size >= 4) throw new Error("temporary_discovery_capacity");
    const timeoutMs = input.resolverTimeoutMs ?? 5000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10_000)
      throw new Error("temporary_discovery_configuration_invalid");
    const controller = new AbortController();
    this.lookups.add(controller);
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;
    let timer: NodeJS.Timeout | undefined;
    try {
      const candidates = (await this.discover({ ...input, signal })).slice(0, 16);
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const matches = new Map<string, LanRoomEndpoint>();
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, candidates.length) }, async () => {
          while (cursor < candidates.length) {
            if (signal.aborted) throw new Error("temporary_discovery_cancelled");
            const candidate = candidates[cursor++]!;
            let result;
            try {
              result = await cancellable(resolveAuthenticated(candidate, code, signal), signal);
            } catch (error) {
              if (signal.aborted) throw error;
              continue;
            }
            if (
              result &&
              result.sessionId === candidate.sessionId &&
              result.authorityId === candidate.authorityId &&
              result.epoch === candidate.epoch &&
              candidate.expiresAt > this.now()
            ) {
              const old = matches.get(result.sessionId);
              if (old && old.epoch === candidate.epoch && old.authorityId !== candidate.authorityId)
                throw new Error("temporary_lan_authority_ambiguous");
              if (!old || old.epoch < candidate.epoch) matches.set(result.sessionId, candidate);
            }
          }
        }),
      );
      if (signal.aborted) throw new Error("temporary_discovery_cancelled");
      if (matches.size > 1) throw new Error("temporary_lan_code_ambiguous");
      const match = matches.values().next().value;
      if (!match) throw new Error("temporary_room_not_found");
      return match;
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.lookups.delete(controller);
    }
  }

  snapshot(): LanRoomEndpoint[] {
    this.prune();
    return [...this.endpoints.values()].map((endpoint) => ({ ...endpoint }));
  }

  getStats(): { pendingQueries: number; endpoints: number; droppedPackets: number } {
    this.prune();
    return {
      pendingQueries: this.pending.size,
      endpoints: this.endpoints.size,
      droppedPackets: this.droppedPackets,
    };
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const lookup of this.lookups) lookup.abort();
    for (const query of [...this.pending.values()])
      query.finish(new Error("temporary_discovery_closed"));
    const socket = this.socket;
    this.socket = undefined;
    if (socket)
      await new Promise<void>((resolve) => {
        try {
          socket.close(() => resolve());
        } catch {
          resolve();
        }
      });
    this.published.clear();
    this.endpoints.clear();
    this.rates.clear();
    this.inboundRates.clear();
  }

  private targets(): LanBroadcastTarget[] {
    return (this.options.targets ?? lanBroadcastTargets()).slice(0, 16);
  }

  private send(value: unknown, target: LanBroadcastTarget): void {
    const data = JSON.stringify(value);
    if (
      !this.socket ||
      this.closed ||
      Buffer.byteLength(data) > 2048 ||
      !isIPv4(target.address) ||
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535
    )
      return;
    this.socket.send(data, target.port, target.address, (error) => {
      if (error) this.droppedPackets += 1;
    });
    this.options.onPacket?.(data);
  }

  private receive(bytes: Buffer, remote: RemoteInfo): void {
    if (
      this.closed ||
      bytes.byteLength > 2048 ||
      !localAddress(remote.address, this.options.allowLoopback) ||
      !this.allowInbound(remote.address)
    ) {
      this.droppedPackets += 1;
      return;
    }
    try {
      const value = JSON.parse(bytes.toString("utf8")) as {
        protocol?: number;
        type?: string;
        nonce?: string;
        probeNonce?: string;
      } & Partial<SignedLanRoomAnnouncement>;
      if (
        value.protocol === 1 &&
        value.type === "probe" &&
        typeof value.nonce === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(value.nonce)
      ) {
        this.prune();
        for (const signed of this.published.values())
          if (this.allowResponse(remote.address))
            this.send(
              { ...signed, probeNonce: value.nonce },
              { address: remote.address, port: remote.port },
            );
        return;
      }
      if (value.probeNonce !== undefined && !this.pending.has(value.probeNonce)) return;
      const signed = verifyLanRoomAnnouncement(value, this.now());
      if (!signed) {
        this.droppedPackets += 1;
        return;
      }
      this.prune();
      const p = signed.payload;
      const key = `${p.sessionId}:${p.authorityId}:${remote.address}`;
      const old = this.endpoints.get(key);
      if (old && (p.epoch < old.epoch || p.issuedAt < old.issuedAt)) return;
      if (!old && this.endpoints.size >= 128) return;
      this.endpoints.set(key, {
        ...p,
        signature: signed.signature,
        address: remote.address,
        endpoint: `wss://${remote.address}:${p.port}`,
      });
    } catch {
      this.droppedPackets += 1;
    }
  }

  private allowResponse(address: string): boolean {
    const now = this.now();
    const global = this.rates.get("*");
    const local = this.rates.get(address);
    if ((global && global.count >= 32) || (local && local.count >= this.responseLimit))
      return false;
    if (!local && this.rates.size >= 257) return false;
    this.rates.set("*", { at: global?.at ?? now, count: (global?.count ?? 0) + 1 });
    this.rates.set(address, { at: local?.at ?? now, count: (local?.count ?? 0) + 1 });
    return true;
  }

  private allowInbound(address: string): boolean {
    this.prune();
    const local = this.inboundRates.get(address);
    const global = this.inboundRates.get("*");
    if (
      (local && local.count >= 32) ||
      (global && global.count >= 256) ||
      (!local && this.inboundRates.size >= 257)
    )
      return false;
    const now = this.now();
    this.inboundRates.set(address, { at: local?.at ?? now, count: (local?.count ?? 0) + 1 });
    this.inboundRates.set("*", { at: global?.at ?? now, count: (global?.count ?? 0) + 1 });
    return true;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, value] of this.published)
      if (value.payload.expiresAt <= now) this.published.delete(key);
    for (const [key, value] of this.endpoints)
      if (value.expiresAt <= now) this.endpoints.delete(key);
    for (const [key, value] of this.rates) if (now - value.at >= 1000) this.rates.delete(key);
    for (const [key, value] of this.inboundRates)
      if (now - value.at >= 1000) this.inboundRates.delete(key);
  }
}
