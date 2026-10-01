import { createHmac } from "node:crypto";
import type { IceServerConfig } from "./protocol";
export const getTurnUrls = (): string[] =>
  (process.env.TURN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("turn:") || value.startsWith("turns:"));

export const getSupportedTurnTransports = (): string[] => {
  const transports = new Set<string>();
  for (const value of getTurnUrls()) {
    if (value.startsWith("turns:")) {
      transports.add("tls");
      continue;
    }
    const transport = new URL(
      value.replace(/^turn:/, "http:"),
      "http://localhost",
    ).searchParams.get("transport");
    transports.add(transport === "tcp" ? "tcp" : "udp");
  }
  return [...transports];
};

export const buildIceServersForPeer = (peerId: string): IceServerConfig[] | undefined => {
  const urls = getTurnUrls();
  if (urls.length === 0) return undefined;

  const sharedSecret = process.env.TURN_SHARED_SECRET?.trim();
  if (sharedSecret) {
    const requestedTtl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS ?? 86_400);
    const ttl = Number.isFinite(requestedTtl)
      ? Math.min(604_800, Math.max(3_600, requestedTtl))
      : 86_400;
    const username = `${Math.floor(Date.now() / 1_000) + ttl}:${peerId}`;
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
  return username && credential ? [{ urls, username, credential }] : undefined;
};
