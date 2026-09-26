import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import type { IceServerConfig } from "./protocol";
import { PhoneMicBridge } from "./phone-mic-bridge";

const loadRelayEnv = async (): Promise<void> => {
  try {
    const source = await readFile(new URL("../../../.env", import.meta.url), "utf8");
    for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // The relay also permits environment-only deployments.
  }
};

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

await loadRelayEnv();

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
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ ok: true, activeSessions: bridge.activeSessions }));
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
