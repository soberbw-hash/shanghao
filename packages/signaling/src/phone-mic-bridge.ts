import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

import type { IceServerConfig } from "./protocol";
import { PHONE_MIC_PAGE } from "./phone-mic-page";

const MAX_SESSIONS = 24;
const MAX_SOCKET_CONNECTIONS = 72;
const PENDING_TTL_MS = 10 * 60_000;
const RESUME_TTL_MS = 60_000;
const HOST_CREATE_WINDOW_MS = 60_000;
const MAX_HOST_CREATES_PER_WINDOW = 8;
const TICKET_TTL_MS = 30_000;
const SIGNAL_TYPES = new Set(["offer", "answer", "candidate", "stop"]);

interface PhoneSession {
  id: string;
  pairingSecret: string;
  resumeSecret?: string;
  resumeExpiresAt?: number;
  host: WebSocket;
  phone?: WebSocket;
  createdAt: number;
  pairedAt?: number;
}

const safeMatch = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const send = (socket: WebSocket | undefined, value: object): void => {
  if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 128 * 1024) {
    socket.send(JSON.stringify(value));
  }
};

export class PhoneMicBridge {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  private readonly sessions = new Map<string, PhoneSession>();
  private readonly hostCreates = new Map<string, { count: number; until: number }>();
  private readonly ticketAttempts = new Map<string, { count: number; until: number }>();
  private readonly hostTickets = new Map<string, number>();
  private readonly sweep: NodeJS.Timeout;

  constructor(
    private readonly iceServers: (id: string) => IceServerConfig[],
    private readonly verifyHost: (accessToken: string) => Promise<boolean>,
  ) {
    this.wss.on("connection", (socket, request) => this.onConnection(socket, request));
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const session of this.sessions.values()) {
        if (
          session.host.readyState !== WebSocket.OPEN ||
          (!session.pairedAt && now - session.createdAt > PENDING_TTL_MS) ||
          (session.pairedAt && !session.phone && (session.resumeExpiresAt ?? 0) < now)
        ) {
          this.endSession(session);
        }
      }
      for (const [address, limit] of this.hostCreates) {
        if (limit.until <= now) this.hostCreates.delete(address);
      }
      for (const [address, limit] of this.ticketAttempts) {
        if (limit.until <= now) this.ticketAttempts.delete(address);
      }
      for (const [ticket, expiry] of this.hostTickets) {
        if (expiry <= now) this.hostTickets.delete(ticket);
      }
    }, 30_000);
    this.sweep.unref();
  }

  get page(): string {
    return PHONE_MIC_PAGE;
  }

  get activeSessions(): number {
    return this.sessions.size;
  }

  attachToServer(server: Server, signalingWss: WebSocketServer): void {
    server.on("upgrade", (request, socket, head) => {
      if (request.url?.split("?")[0] === "/phone-mic/ws") {
        this.handleUpgrade(request, socket, head);
      } else {
        signalingWss.handleUpgrade(request, socket, head, (client) => {
          signalingWss.emit("connection", client, request);
        });
      }
    });
  }

  servePage(request: IncomingMessage, response: ServerResponse): boolean {
    if (request.method !== "GET" || request.url?.split("?")[0] !== "/phone-mic") return false;
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; connect-src 'self' ws: wss:; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    response.end(PHONE_MIC_PAGE);
    return true;
  }

  async serveHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    return this.servePage(request, response) || this.serveTicket(request, response);
  }

  async serveTicket(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (request.method !== "POST" || request.url?.split("?")[0] !== "/phone-mic/ticket")
      return false;
    const isLoopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      request.socket.remoteAddress ?? "",
    );
    const isProxied = isLoopback && request.headers["x-forwarded-proto"] === "https";
    if (!isProxied && (process.env.NODE_ENV === "production" || !isLoopback)) {
      response.writeHead(403, { "cache-control": "no-store" }).end();
      return true;
    }
    if (
      Number(request.headers["content-length"] ?? 0) > 0 ||
      request.headers["transfer-encoding"]
    ) {
      response.writeHead(413, { "cache-control": "no-store" }).end();
      request.destroy();
      return true;
    }
    const remoteAddress = request.socket.remoteAddress ?? "unknown";
    const address = isProxied
      ? request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || remoteAddress
      : remoteAddress;
    const now = Date.now();
    const previous = this.ticketAttempts.get(address);
    const limit =
      previous && previous.until > now
        ? previous
        : { count: 0, until: now + HOST_CREATE_WINDOW_MS };
    limit.count++;
    this.ticketAttempts.set(address, limit);
    if (limit.count > MAX_HOST_CREATES_PER_WINDOW) {
      response.writeHead(429, { "cache-control": "no-store", "retry-after": "60" }).end();
      return true;
    }
    const authorization = request.headers.authorization?.trim() ?? "";
    const accessToken = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    let authorized = false;
    if (accessToken && accessToken.length <= 8_192) {
      try {
        authorized = await this.verifyHost(accessToken);
      } catch {
        /* Invalid or expired account. */
      }
    }
    if (!authorized || this.hostTickets.size >= MAX_SESSIONS) {
      response.writeHead(authorized ? 429 : 401, { "cache-control": "no-store" });
      response.end();
      return true;
    }
    const ticket = randomBytes(32).toString("hex");
    this.hostTickets.set(ticket, Date.now() + TICKET_TTL_MS);
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ ticket }));
    return true;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.wss.clients.size >= MAX_SOCKET_CONNECTIONS) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (client) => {
      this.wss.emit("connection", client, request);
    });
  }

  close(): void {
    clearInterval(this.sweep);
    for (const session of this.sessions.values()) this.endSession(session);
    this.hostTickets.clear();
    this.wss.close();
  }

  private endSession(session: PhoneSession): void {
    this.sessions.delete(session.id);
    session.phone?.close(1000, "session_ended");
    session.host.close(1000, "session_ended");
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    let session: PhoneSession | undefined;
    let role: "host" | "phone" | undefined;
    const timeout = setTimeout(() => {
      if (!role) socket.close(4408, "handshake_timeout");
    }, 10_000);

    socket.on("message", (raw) => {
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        message = parsed as Record<string, unknown>;
      } catch {
        socket.close(4400, "invalid_message");
        return;
      }
      if (!role) {
        if (message.type === "create") {
          const ticket = typeof message.ticket === "string" ? message.ticket : "";
          const expiry = this.hostTickets.get(ticket);
          if (!expiry || expiry <= Date.now()) {
            socket.close(4401, "host_authorization_required");
            return;
          }
          this.hostTickets.delete(ticket);
          const remoteAddress = request.socket.remoteAddress ?? "unknown";
          const address = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)
            ? request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || remoteAddress
            : remoteAddress;
          const now = Date.now();
          const previous = this.hostCreates.get(address);
          const limit =
            previous && previous.until > now
              ? previous
              : { count: 0, until: now + HOST_CREATE_WINDOW_MS };
          limit.count++;
          this.hostCreates.set(address, limit);
          if (limit.count > MAX_HOST_CREATES_PER_WINDOW) {
            socket.close(4429, "rate_limited");
            return;
          }
          if (this.sessions.size >= MAX_SESSIONS) {
            socket.close(4429, "server_busy");
            return;
          }
          role = "host";
          session = {
            id: randomUUID(),
            pairingSecret: randomBytes(24).toString("hex"),
            host: socket,
            createdAt: Date.now(),
          };
          this.sessions.set(session.id, session);
          send(socket, {
            type: "created",
            sessionId: session.id,
            pairingSecret: session.pairingSecret,
            iceServers: this.iceServers(session.id),
          });
        } else if (
          message.type === "join" &&
          typeof message.sessionId === "string" &&
          typeof message.secret === "string"
        ) {
          const candidate = this.sessions.get(message.sessionId);
          const isPairing =
            candidate?.pairingSecret && safeMatch(message.secret, candidate.pairingSecret);
          const isResume =
            candidate?.resumeSecret &&
            (candidate.resumeExpiresAt ?? 0) > Date.now() &&
            safeMatch(message.secret, candidate.resumeSecret);
          if (!candidate || (!isPairing && !isResume) || candidate.phone) {
            socket.close(4403, "invalid_pairing");
            return;
          }
          role = "phone";
          session = candidate;
          candidate.pairingSecret = "";
          candidate.pairedAt = Date.now();
          candidate.resumeSecret = randomBytes(24).toString("hex");
          candidate.resumeExpiresAt = Date.now() + RESUME_TTL_MS;
          candidate.phone = socket;
          send(socket, {
            type: "joined",
            resumeSecret: candidate.resumeSecret,
            iceServers: this.iceServers(candidate.id),
          });
          send(candidate.host, { type: "phone_connected" });
        } else {
          socket.close(4400, "invalid_handshake");
        }
        if (role) clearTimeout(timeout);
        return;
      }
      if (!session || !SIGNAL_TYPES.has(String(message.type))) return;
      if (role === "phone") {
        if (message.type === "offer" && typeof message.sdp === "string") {
          send(session.host, { type: "offer", sdp: message.sdp });
        } else if (message.type === "candidate" && message.candidate) {
          send(session.host, { type: "candidate", candidate: message.candidate });
        } else if (message.type === "stop") {
          send(session.host, { type: "phone_stopped" });
        }
      } else if (session.phone) {
        if (message.type === "answer" && typeof message.sdp === "string") {
          send(session.phone, { type: "answer", sdp: message.sdp });
        } else if (message.type === "candidate" && message.candidate) {
          send(session.phone, { type: "candidate", candidate: message.candidate });
        }
      }
    });

    socket.on("close", () => {
      clearTimeout(timeout);
      if (!session) return;
      if (!this.sessions.has(session.id)) return;
      if (role === "host") this.endSession(session);
      else if (session.phone === socket) {
        session.phone = undefined;
        session.resumeExpiresAt = Date.now() + RESUME_TTL_MS;
        send(session.host, { type: "phone_disconnected" });
      }
    });
  }
}
