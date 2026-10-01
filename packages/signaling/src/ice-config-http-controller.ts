import type { IncomingMessage, ServerResponse } from "node:http";
import { buildIceServersForPeer, getSupportedTurnTransports } from "./signaling-ice-config";

/** Owns diagnostic ICE requests and their bounded rate windows; no room lifecycle state. */
export class IceConfigHttpController {
  private readonly rateWindows = new Map<string, { startedAt: number; count: number }>();
  constructor(private readonly authorized: (request: IncomingMessage) => boolean) {}
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    if (request.method !== "GET" || !request.url?.startsWith("/ice-config")) return false;
    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        ...(status === 429 ? { "retry-after": "60" } : {}),
      });
      response.end(JSON.stringify(body));
    };
    if (!this.authorized(request)) {
      send(401, { error: "unauthorized" });
      return true;
    }
    const now = Date.now();
    const key = request.socket.remoteAddress ?? "unknown";
    for (const [address, window] of this.rateWindows)
      if (now - window.startedAt >= 60_000) this.rateWindows.delete(address);
    const window = this.rateWindows.get(key);
    if (window ? ++window.count > 30 : this.rateWindows.size >= 10_000) {
      send(429, { error: "rate_limited" });
      return true;
    }
    if (!window) this.rateWindows.set(key, { startedAt: now, count: 1 });
    const url = new URL(request.url, "http://localhost");
    const peerId =
      (url.searchParams.get("peerId") ?? "diagnostic-peer")
        .replace(/[^a-zA-Z0-9._-]/g, "")
        .slice(0, 64) || "diagnostic-peer";
    const iceServers = buildIceServersForPeer(peerId) ?? [];
    send(200, {
      iceServers,
      serverTime: now,
      turnConfigured: iceServers.length > 0,
      supportedTurnTransports: getSupportedTurnTransports(),
    });
    return true;
  }
}
