import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocket, type RawData } from "ws";
import { TemporaryRoomAuthenticator } from "./temporary-room-auth";
import {
  normalizeInternetRegistration,
  type SignedInternetRegistration,
  type TemporaryInternetHandoff,
} from "./temporary-internet-protocol";
import { TemporaryInternetDirectory } from "./temporary-internet-directory";
import type { TemporaryAuthProof } from "../../shared/src/types/temporary-room.types";
import { buildIceServersForPeer } from "./signaling-ice-config";
import { TemporaryCodeAttempts } from "./temporary-code-attempts";
interface Provider {
  socket: WebSocket;
  signed: SignedInternetRegistration;
}
interface Entry {
  authority: SignedInternetRegistration;
  provider?: Provider;
  members: Map<string, Provider>;
  retainedUntil: number;
  terminal: boolean;
}
interface Pipe {
  id: string;
  entry: Entry;
  provider: Provider;
  ownerControl: WebSocket;
  ownerDeviceId: string;
  consumerSecret: Buffer;
  providerSecret: Buffer;
  expiresAt: number;
  consumer?: WebSocket;
  producer?: WebSocket;
  bytes: number;
  windowAt: number;
  paired: boolean;
}
function fail(code: string): never {
  throw Error(code);
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail("temporary_bridge_request_invalid");
const text = (v: unknown, max = 512): string =>
  typeof v === "string" && v.length > 0 && v.length <= max
    ? v
    : fail("temporary_bridge_request_invalid");
/** Ephemeral exact-code directory and bounded encrypted-byte pairing. It never parses inner TLS or room credentials. */
export class TemporaryInternetBroker {
  private readonly auth: TemporaryRoomAuthenticator;
  private readonly sockets = new WeakSet<WebSocket>();
  private readonly entries = new Map<string, Entry>();
  private readonly codes = new Map<string, string>();
  private readonly pipes = new Map<string, Pipe>();
  private readonly rates = new Map<string, { at: number; count: number }>();
  private readonly lookups = new Map<string, { at: number; count: number }>();
  private readonly directory: TemporaryInternetDirectory;
  private readonly ready: Promise<void>;
  constructor(
    collision: (code: string) => boolean,
    private readonly now = Date.now,
    file?: string,
    private readonly codeAttempts = new TemporaryCodeAttempts(now),
  ) {
    this.auth = new TemporaryRoomAuthenticator({ now });
    this.directory = new TemporaryInternetDirectory(file, collision, now);
    this.ready = this.directory.ready.then(() => {
      for (const record of this.directory.records())
        if (record.retainedUntil > now()) {
          this.entries.set(record.authority.payload.sessionId, { ...record, members: new Map() });
          if (!record.terminal)
            this.codes.set(record.authority.payload.code, record.authority.payload.sessionId);
        }
    });
    void this.ready.catch(() => undefined);
  }
  hasCode(code: string): boolean {
    return this.directory.hasCode(code);
  }
  owns(socket: WebSocket) {
    return this.sockets.has(socket);
  }
  async flush(): Promise<void> {
    await this.ready;
    await this.directory.flush();
  }
  attach(socket: WebSocket, address: string) {
    this.sockets.add(socket);
    let pipe: Pipe | undefined;
    let inFlight = 0;
    socket.on("message", async (raw: RawData, binary: boolean) => {
      if (pipe?.paired) {
        const peer = pipe.consumer === socket ? pipe.producer : pipe.consumer;
        const bytes = Buffer.byteLength(raw as Buffer);
        if (
          !binary ||
          bytes > 64 * 1024 ||
          !peer ||
          peer.readyState !== WebSocket.OPEN ||
          peer.bufferedAmount > 1024 * 1024
        ) {
          this.closePipe(pipe);
          return;
        }
        if (this.now() - pipe.windowAt >= 1000) {
          pipe.windowAt = this.now();
          pipe.bytes = 0;
        }
        if ((pipe.bytes += bytes) > 8 * 1024 * 1024) {
          this.closePipe(pipe);
          return;
        }
        peer.send(raw, { binary: true });
        return;
      }
      if (binary || Buffer.byteLength(raw as Buffer) > 256 * 1024 || inFlight >= 4) {
        socket.close(4400, "temporary_bridge_request_invalid");
        return;
      }
      inFlight++;
      let requestId = "invalid";
      try {
        await this.ready;
        this.consume(address);
        const d = object(JSON.parse(raw.toString()));
        requestId = text(d.requestId, 128);
        if (d.type !== "temporary_bridge_request" || d.version !== 1)
          fail("temporary_bridge_protocol_mismatch");
        if (d.command === "pair") {
          if (pipe) fail("temporary_bridge_pair_replayed");
          const p = this.pipes.get(text(d.pipeId, 64));
          if (!p || p.expiresAt <= this.now() || !["consumer", "provider"].includes(String(d.side)))
            fail("temporary_bridge_pipe_invalid");
          const encoded = text(d.secret, 43);
          if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) fail("temporary_bridge_pipe_invalid");
          const secret = Buffer.from(encoded, "base64url");
          const expected = d.side === "consumer" ? p.consumerSecret : p.providerSecret;
          if (secret.length !== expected.length || !timingSafeEqual(secret, expected))
            fail("temporary_bridge_pipe_invalid");
          if (d.side === "consumer") {
            if (p.consumer) fail("temporary_bridge_pair_replayed");
            p.consumer = socket;
          } else {
            if (p.producer) fail("temporary_bridge_pair_replayed");
            p.producer = socket;
          }
          pipe = p;
          this.send(socket, {
            type: "temporary_bridge_response",
            version: 1,
            requestId,
            ok: true,
            value: { waiting: true },
          });
          if (p.consumer && p.producer) {
            p.paired = true;
            p.consumerSecret.fill(0);
            p.providerSecret.fill(0);
            for (const s of [p.consumer, p.producer])
              this.send(s, { type: "temporary_bridge_paired", version: 1 });
          }
          return;
        }
        if (pipe) fail("temporary_bridge_request_invalid");
        if (d.command === "challenge") {
          const challenge = this.auth.issueChallenge({
            publicKey: text(d.publicKey),
            sessionId: d.sessionId === undefined ? undefined : text(d.sessionId, 64),
          });
          this.reply(socket, requestId, challenge);
          return;
        }
        const principal = this.auth.verify(d.proof as TemporaryAuthProof);
        if (d.command === "lookup") {
          const rate = this.lookups.get(address) ?? { at: this.now(), count: 0 };
          if (this.now() - rate.at >= 60000) {
            rate.at = this.now();
            rate.count = 0;
          }
          if (++rate.count > 60) fail("temporary_bridge_rate_limited");
          this.lookups.set(address, rate);
          const result = this.codeAttempts.attempt(
            principal.deviceId,
            address,
            () => {
              const code = text(d.code, 8);
              if (!/^\d{8}$/.test(code)) fail("temporary_room_code_invalid");
              const e = this.entries.get(this.codes.get(code) ?? "");
              const available =
                e &&
                !e.terminal &&
                e.provider?.socket.readyState === WebSocket.OPEN &&
                e.authority.payload.expiresAt > this.now()
                  ? e.authority
                  : null;
              return { known: Boolean(e && !e.terminal), available };
            },
            (value) => (value.available ? true : value.known ? undefined : false),
          );
          this.reply(socket, requestId, result.available);
          return;
        }
        if (d.command === "register") {
          if (d.role !== "authority" && d.role !== "member")
            fail("temporary_bridge_registration_invalid");
          const signed = normalizeInternetRegistration(
            d.signed as SignedInternetRegistration,
            this.now(),
          );
          if (!signed) fail("temporary_bridge_registration_invalid");
          const p = signed.payload;
          if (
            principal.deviceId !== p.authorityId ||
            principal.publicKey !== p.publicKey ||
            principal.sessionId !== p.sessionId
          )
            fail("temporary_bridge_registration_invalid");
          let entry = this.entries.get(p.sessionId);
          const provider = { socket, signed };
          if (d.role === "member") {
            if (
              !entry ||
              entry.terminal ||
              entry.authority.payload.epoch !== p.epoch ||
              !entry.authority.payload.members.some(
                (m) => m.deviceId === principal.deviceId && m.publicKey === principal.publicKey,
              )
            )
              fail("temporary_bridge_membership_required");
            const previous = entry.members.get(principal.deviceId);
            if (previous && previous.socket !== socket)
              previous.socket.close(4001, "temporary_bridge_replaced");
            entry.members.set(principal.deviceId, provider);
          } else {
            const record = await this.directory.register(
              signed,
              d.handoff as TemporaryInternetHandoff | undefined,
            );
            entry = this.entries.get(p.sessionId) ?? { ...record, members: new Map() };
            const oldProvider = entry.provider;
            if (entry.authority.payload.code !== p.code)
              this.codes.delete(entry.authority.payload.code);
            entry.authority = signed;
            entry.provider = provider;
            entry.retainedUntil = record.retainedUntil;
            this.entries.set(p.sessionId, entry);
            this.codes.set(p.code, p.sessionId);
            if (oldProvider && oldProvider.socket !== socket)
              oldProvider.socket.close(4001, "temporary_bridge_replaced");
            for (const [id, member] of entry.members)
              if (!p.members.some((m) => m.deviceId === id)) {
                entry.members.delete(id);
                member.socket.close(4003, "temporary_member_removed");
              }
          }
          this.reply(socket, requestId, {
            registered: true,
            iceServers: buildIceServersForPeer(principal.deviceId) ?? [],
          });
          return;
        }
        if (d.command === "withdraw") {
          const entry = this.entries.get(principal.sessionId ?? "");
          const member = entry?.members.get(principal.deviceId);
          if (!entry || !member || member.socket !== socket)
            fail("temporary_bridge_membership_required");
          entry.members.delete(principal.deviceId);
          for (const p of this.pipes.values()) if (p.provider === member) this.closePipe(p);
          this.reply(socket, requestId, { withdrawn: true });
          return;
        }
        if (d.command === "unregister") {
          const entry = this.entries.get(principal.sessionId ?? "");
          if (
            !entry ||
            entry.authority.payload.authorityId !== principal.deviceId ||
            entry.provider?.socket !== socket
          )
            fail("temporary_bridge_authority_invalid");
          const record = await this.directory.closeSession(
            entry.authority.payload.sessionId,
            principal.deviceId,
          );
          entry.terminal = true;
          this.codes.delete(entry.authority.payload.code);
          entry.retainedUntil = record.retainedUntil;
          for (const p of this.pipes.values()) if (p.entry === entry) this.closePipe(p);
          this.reply(socket, requestId, { ended: true });
          return;
        }
        if (d.command === "open") {
          const entry = this.entries.get(principal.sessionId ?? "");
          const deviceId =
            d.deviceId === undefined ? entry?.authority.payload.authorityId : text(d.deviceId, 64);
          const provider =
            entry &&
            (deviceId === entry.authority.payload.authorityId
              ? (entry.provider ?? entry.members.get(deviceId!))
              : entry.members.get(deviceId!));
          if (
            !entry ||
            entry.terminal ||
            !provider ||
            provider.socket.readyState !== WebSocket.OPEN ||
            provider.signed.payload.expiresAt <= this.now()
          )
            fail("temporary_bridge_unavailable");
          if (
            this.pipes.size >= 256 ||
            [...this.pipes.values()].filter((p) => p.entry === entry).length >= 24 ||
            [...this.pipes.values()].filter((p) => p.ownerDeviceId === principal.deviceId).length >=
              8
          )
            fail("temporary_bridge_busy");
          const id = randomBytes(24).toString("base64url"),
            consumerSecret = randomBytes(32),
            providerSecret = randomBytes(32);
          const p: Pipe = {
            id,
            entry,
            provider,
            ownerControl: socket,
            ownerDeviceId: principal.deviceId,
            consumerSecret,
            providerSecret,
            expiresAt: this.now() + 10000,
            bytes: 0,
            windowAt: this.now(),
            paired: false,
          };
          this.pipes.set(id, p);
          this.send(provider.socket, {
            type: "temporary_bridge_open",
            version: 1,
            pipeId: id,
            secret: providerSecret.toString("base64url"),
            expiresAt: p.expiresAt,
          });
          this.reply(socket, requestId, {
            pipeId: id,
            secret: consumerSecret.toString("base64url"),
            expiresAt: p.expiresAt,
            registration: provider.signed,
          });
          return;
        }
        fail("temporary_bridge_command_invalid");
      } catch (error) {
        this.send(socket, {
          type: "temporary_bridge_response",
          version: 1,
          requestId,
          ok: false,
          code:
            error instanceof Error && /^temporary_[a-z_]+$/.test(error.message)
              ? error.message
              : "temporary_bridge_request_invalid",
        });
      } finally {
        inFlight--;
      }
    });
    socket.once("close", () => {
      if (pipe) this.closePipe(pipe);
      for (const p of this.pipes.values())
        if (p.provider.socket === socket || (!p.paired && p.ownerControl === socket))
          this.closePipe(p);
      for (const e of this.entries.values()) {
        if (e.provider?.socket === socket) {
          e.provider = undefined;
          for (const p of this.pipes.values()) if (p.entry === e) this.closePipe(p);
        }
        for (const [id, p] of e.members)
          if (p.socket === socket) {
            e.members.delete(id);
            for (const pipe of this.pipes.values()) if (pipe.provider === p) this.closePipe(pipe);
          }
      }
    });
  }
  private reply(socket: WebSocket, requestId: string, value: unknown) {
    this.send(socket, {
      type: "temporary_bridge_response",
      version: 1,
      requestId,
      ok: true,
      value,
    });
  }
  private send(socket: WebSocket, value: unknown) {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024)
      socket.send(JSON.stringify(value));
    else socket.terminate();
  }
  private closePipe(p: Pipe) {
    if (!this.pipes.delete(p.id)) return;
    p.consumer?.terminate();
    p.producer?.terminate();
    p.consumerSecret.fill(0);
    p.providerSecret.fill(0);
  }
  private consume(address: string) {
    const now = this.now();
    for (const [key, v] of this.rates) if (now - v.at >= 60000) this.rates.delete(key);
    if (!this.rates.has(address) && this.rates.size >= 4096) fail("temporary_bridge_busy");
    const r = this.rates.get(address) ?? { at: now, count: 0 };
    this.rates.set(address, r);
    if (++r.count > 2400) fail("temporary_bridge_rate_limited");
  }
  sweep() {
    this.auth.sweep();
    for (const p of this.pipes.values())
      if (!p.paired && p.expiresAt <= this.now()) this.closePipe(p);
    for (const [key, r] of this.lookups) if (this.now() - r.at >= 60000) this.lookups.delete(key);
    for (const [id, e] of this.entries)
      if (e.retainedUntil <= this.now()) {
        this.codes.delete(e.authority.payload.code);
        this.entries.delete(id);
        for (const p of this.pipes.values()) if (p.entry === e) this.closePipe(p);
      }
  }
}
