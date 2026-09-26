import { createHmac } from "node:crypto";
import { createServer } from "node:http";

import type { IceServerConfig } from "./protocol";
import { PhoneMicBridge } from "./phone-mic-bridge";
import { readPhoneMicHealth } from "./phone-mic-health";

const iceServersForSession = (sessionId: string): IceServerConfig[] => {
  const urls = (process.env.TURN_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.startsWith("turn:") || url.startsWith("turns:"));
  if (urls.length === 0) return [];

  const sharedSecret = process.env.TURN_SHARED_SECRET?.trim();
  if (sharedSecret) {
    const requestedTtl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS ?? 86_400);
    const ttl = Number.isFinite(requestedTtl)
      ? Math.min(604_800, Math.max(3_600, requestedTtl))
      : 86_400;
    const username = `${Math.floor(Date.now() / 1_000) + ttl}:${sessionId}`;
    return [
      {
        urls,
        username,
        credential: createHmac("sha1", sharedSecret).update(username).digest("base64"),
      },
    ];
  }

  const username = process.env.TURN_USERNAME?.trim();
  const credential = process.env.TURN_CREDENTIAL?.trim();
  return username && credential ? [{ urls, username, credential }] : [];
};

const version = process.env.SHANGHAO_VERSION?.trim() || "development";
const startedAt = Date.now();

const relayPort = Number(process.env.PORT ?? 43821);
const sidecarPort = Number(process.env.PHONE_MIC_SIDECAR_PORT ?? 43822);
if (
  !Number.isInteger(relayPort) ||
  !Number.isInteger(sidecarPort) ||
  relayPort < 1 ||
  sidecarPort < 1 ||
  sidecarPort > 65_535 ||
  relayPort > 65_535 ||
  relayPort === sidecarPort
) {
  throw new Error("Invalid relay or phone microphone sidecar port");
}

const bridge = new PhoneMicBridge(iceServersForSession, async (token) => {
  const response = await fetch(`http://127.0.0.1:${relayPort}/api/account/me`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(4_000),
  });
  await response.body?.cancel();
  return response.ok;
});

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/phone-mic/health") {
    void readPhoneMicHealth({
      relayPort,
      activeSessions: bridge.activeSessions,
      startedAt,
      version,
    }).then((health) => {
      response.writeHead(health.ok ? 200 : 503, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(health));
    });
    return;
  }
  void bridge
    .serveHttpRequest(request, response)
    .then((served) => {
      if (!served) response.writeHead(404).end();
    })
    .catch(() => {
      if (!response.headersSent) response.writeHead(500).end();
    });
});

server.on("upgrade", (request, socket, head) => {
  if (request.url?.split("?")[0] === "/phone-mic/ws") {
    bridge.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(sidecarPort, "127.0.0.1", () => {
  // eslint-disable-next-line no-console -- A single startup line is useful in systemd diagnostics.
  console.log(`ShangHao phone microphone sidecar listening on 127.0.0.1:${sidecarPort}`);
});

const shutdown = (): void => {
  bridge.close();
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
