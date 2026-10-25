import { randomUUID, createHash } from "node:crypto";
import { connect as connectTls } from "node:tls";
import { WebSocket, createWebSocketStream } from "ws";
import { Duplex, Transform } from "node:stream";
import {
  TEMPORARY_AUTH_AUDIENCE,
  type TemporaryAuthChallenge,
} from "../../../../packages/shared/src/types/temporary-room.types";
import {
  verifyInternetRegistration,
  type SignedInternetRegistration,
} from "../../../../packages/signaling/src/temporary-internet-protocol";
import type { TemporaryIdentityStore } from "./temporary-identity-store";
export interface TemporaryInternetEndpoint {
  url: string;
  certificate?: string;
}
export interface TemporaryInternetRoute {
  broker: TemporaryInternetEndpoint;
  sessionId: string;
  deviceId: string;
  registration: SignedInternetRegistration;
}
/** TLS may write a large encrypted batch. Bound each outer WS frame without changing the inner byte stream. */
export function internetByteStream(socket: WebSocket): Duplex {
  const raw = createWebSocketStream(socket);
  const chunks = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      if (chunk.length > 2 * 1024 * 1024) {
        callback(Error("temporary_bridge_payload_too_large"));
        return;
      }
      for (let offset = 0; offset < chunk.length; offset += 16 * 1024)
        this.push(chunk.subarray(offset, offset + 16 * 1024));
      callback();
    },
  });
  chunks.pipe(raw);
  const duplex = Duplex.from({ readable: raw, writable: chunks });
  // TLS wraps this Duplex through JSStreamSocket; its cancellation can destroy the underlying
  // halves after the TLS socket has already settled. Keep one owner for those late stream errors.
  const cleanup = () => {
    chunks.destroy();
    raw.destroy();
    socket.terminate();
  };
  duplex.on("error", cleanup);
  duplex.once("close", cleanup);
  raw.on("error", (error) => duplex.destroy(error));
  chunks.on("error", (error) => duplex.destroy(error));
  raw.once("close", () => duplex.destroy());
  return duplex;
}
interface PipeOffer {
  pipeId: string;
  secret: string;
  expiresAt: number;
  registration: SignedInternetRegistration;
}
export function internetBrokerUrl(endpoint: string): string {
  const url = new URL(endpoint);
  if (
    url.protocol !== "wss:" &&
    !(url.protocol === "ws:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  )
    throw Error("temporary_secure_connection_required");
  if (url.username || url.password) throw Error("temporary_endpoint_invalid");
  url.pathname = "/temporary-bridge";
  url.search = "";
  url.hash = "";
  return url.toString();
}
export function internetOuterSocket(endpoint: TemporaryInternetEndpoint): WebSocket {
  return new WebSocket(internetBrokerUrl(endpoint.url), {
    handshakeTimeout: 5000,
    maxPayload: 256 * 1024,
    ...(endpoint.certificate
      ? { ca: endpoint.certificate, servername: "shanghao.local", rejectUnauthorized: true }
      : {}),
  });
}
export class TemporaryInternetConnection {
  private socket?: WebSocket;
  private opening?: Promise<WebSocket>;
  private closed = false;
  private readonly pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
      socket: WebSocket;
    }
  >();
  private readonly offers = new Set<(offer: PipeOffer) => void>();
  constructor(
    private readonly identity: TemporaryIdentityStore,
    readonly endpoint: TemporaryInternetEndpoint,
  ) {}
  onPipe(listener: (offer: PipeOffer) => void) {
    this.offers.add(listener);
    return () => this.offers.delete(listener);
  }
  private connect(): Promise<WebSocket> {
    if (this.closed) return Promise.reject(Error("temporary_bridge_closed"));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.opening) return this.opening;
    this.opening = new Promise<WebSocket>((resolve, reject) => {
      const socket = internetOuterSocket(this.endpoint);
      this.socket = socket;
      socket.once("open", () => {
        if (this.closed) {
          socket.terminate();
          reject(Error("temporary_bridge_closed"));
        } else resolve(socket);
      });
      socket.once("error", () => reject(Error("temporary_bridge_unavailable")));
      socket.on("message", (raw) => {
        if (socket !== this.socket) return;
        try {
          const m = JSON.parse(raw.toString());
          if (m.type === "temporary_bridge_open" && m.version === 1) {
            for (const listener of this.offers) listener(m);
            return;
          }
          if (m.type === "error") {
            for (const p of this.pending.values()) {
              clearTimeout(p.timer);
              p.reject(Error("temporary_bridge_unsupported"));
            }
            this.pending.clear();
            return;
          }
          if (m.type !== "temporary_bridge_response" || m.version !== 1) return;
          const p = this.pending.get(m.requestId);
          if (!p) return;
          this.pending.delete(m.requestId);
          clearTimeout(p.timer);
          if (m.ok === true) p.resolve(m.value);
          else
            p.reject(
              Error(/^temporary_[a-z_]+$/.test(m.code) ? m.code : "temporary_bridge_unavailable"),
            );
        } catch {
          socket.terminate();
        }
      });
      socket.once("close", () => {
        if (this.socket === socket) this.socket = undefined;
        for (const [id, p] of this.pending) {
          if (p.socket !== socket) continue;
          clearTimeout(p.timer);
          p.reject(Error("temporary_bridge_unavailable"));
          this.pending.delete(id);
        }
        reject(Error("temporary_bridge_unavailable"));
      });
    }).finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }
  private async rpc(data: Record<string, unknown>): Promise<unknown> {
    const socket = await this.connect();
    if (this.pending.size >= 16) throw Error("temporary_bridge_busy");
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Error("temporary_bridge_unavailable"));
      }, 5000);
      this.pending.set(requestId, { resolve, reject, timer, socket });
      socket.send(
        JSON.stringify({ type: "temporary_bridge_request", version: 1, requestId, ...data }),
      );
    });
  }
  async request(
    command: string,
    value: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown> {
    const profile = await this.identity.getProfile();
    if (!profile) throw Error("temporary_profile_required");
    const challenge = (await this.rpc({
      command: "challenge",
      publicKey: profile.publicKey,
      sessionId,
    })) as TemporaryAuthChallenge;
    const proof = await this.identity.signChallenge(challenge, {
      audience: TEMPORARY_AUTH_AUDIENCE,
      sessionId,
    });
    return this.rpc({ command, proof, ...value });
  }
  close() {
    this.closed = true;
    this.socket?.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("temporary_bridge_closed"));
    }
    this.pending.clear();
    this.offers.clear();
  }
}
export async function pairInternetSocket(
  endpoint: TemporaryInternetEndpoint,
  offer: Pick<PipeOffer, "pipeId" | "secret" | "expiresAt">,
  side: "consumer" | "provider",
  signal?: AbortSignal,
): Promise<WebSocket> {
  if (
    !/^[A-Za-z0-9_-]{32}$/.test(offer.pipeId) ||
    !/^[A-Za-z0-9_-]{43}$/.test(offer.secret) ||
    offer.expiresAt <= Date.now() ||
    signal?.aborted
  )
    throw Error("temporary_bridge_pipe_invalid");
  const socket = internetOuterSocket(endpoint);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(Error("temporary_bridge_unavailable")),
      Math.min(10000, offer.expiresAt - Date.now()),
    );
    const abort = () => finish(Error("temporary_bridge_cancelled"));
    function finish(error?: Error) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.off("message", message);
      if (error) {
        socket.terminate();
        reject(error);
      } else resolve(socket);
    }
    const message = (raw: import("ws").RawData) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === "temporary_bridge_paired" && m.version === 1) finish();
        else if (m.ok === false) finish(Error("temporary_bridge_pipe_invalid"));
      } catch {
        finish(Error("temporary_bridge_pipe_invalid"));
      }
    };
    socket.on("message", message);
    socket.once("error", () => finish(Error("temporary_bridge_unavailable")));
    socket.once("close", () => finish(Error("temporary_bridge_unavailable")));
    socket.once("open", () =>
      socket.send(
        JSON.stringify({
          type: "temporary_bridge_request",
          version: 1,
          requestId: randomUUID(),
          command: "pair",
          side,
          pipeId: offer.pipeId,
          secret: offer.secret,
        }),
      ),
    );
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function openInternetRoomSocket(
  identity: TemporaryIdentityStore,
  route: TemporaryInternetRoute,
  signal?: AbortSignal,
): Promise<WebSocket> {
  const connection = new TemporaryInternetConnection(identity, route.broker);
  let outer: WebSocket | undefined;
  let inner: WebSocket | undefined;
  const abort = () => {
    connection.close();
    outer?.terminate();
    inner?.terminate();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw Error("temporary_bridge_cancelled");
    const offer = (await connection.request(
      "open",
      { deviceId: route.deviceId },
      route.sessionId,
    )) as PipeOffer;
    if (
      !verifyInternetRegistration(offer.registration) ||
      offer.registration.payload.sessionId !== route.sessionId ||
      offer.registration.payload.authorityId !== route.deviceId ||
      offer.registration.payload.publicKey !== route.registration.payload.publicKey ||
      offer.registration.payload.epoch < route.registration.payload.epoch
    )
      throw Error("temporary_bridge_authority_invalid");
    outer = await pairInternetSocket(route.broker, offer, "consumer", signal);
    const stream = internetByteStream(outer);
    const tls = connectTls({
      socket: stream,
      servername: "shanghao.local",
      rejectUnauthorized: false,
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          tls.destroy();
          reject(error);
        } else resolve();
      };
      const timer = setTimeout(() => finish(Error("temporary_bridge_tls_timeout")), 5000);
      tls.once("secureConnect", () => {
        const cert = tls.getPeerCertificate().raw;
        if (
          !cert ||
          createHash("sha256").update(cert).digest("hex") !==
            offer.registration.payload.certificateSha256
        )
          finish(Error("temporary_lan_tls_pin_mismatch"));
        else finish();
      });
      tls.on("error", () => finish(Error("temporary_bridge_tls_failed")));
      tls.once("close", () => finish(Error("temporary_bridge_tls_failed")));
    });
    if (signal?.aborted) {
      tls.destroy();
      throw Error("temporary_bridge_cancelled");
    }
    const socket = new WebSocket("wss://shanghao.local/temporary", {
      createConnection: () => tls,
      handshakeTimeout: 5000,
      maxPayload: 2 * 1024 * 1024,
    });
    inner = socket;
    const transport = outer;
    socket.once("close", () => {
      transport.terminate();
      signal?.removeEventListener("abort", abort);
    });
    return socket;
  } catch (error) {
    outer?.terminate();
    signal?.removeEventListener("abort", abort);
    throw error;
  } finally {
    connection.close();
  }
}
