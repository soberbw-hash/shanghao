import type { DeepLinkInvite } from "@private-voice/shared";

export const SHANGHAO_PROTOCOL = "shanghao";
export const SHANGHAO_AUTH_REDIRECT_URL = `${SHANGHAO_PROTOCOL}://auth/confirmed`;

const ALLOWED_CHANNEL_IDS = new Set<DeepLinkInvite["channelId"]>(["main", "side"]);

export const parseDeepLinkInvite = (rawValue: string): DeepLinkInvite | undefined => {
  try {
    const url = new URL(rawValue);
    if (url.protocol !== `${SHANGHAO_PROTOCOL}:` || url.hostname !== "join") return undefined;

    const channelId = url.searchParams.get("room") as DeepLinkInvite["channelId"] | null;
    const rawServerUrl = url.searchParams.get("server");
    if (!channelId || !ALLOWED_CHANNEL_IDS.has(channelId)) return undefined;
    const rawExpiresAt = url.searchParams.get("expires");
    if (rawExpiresAt !== null) {
      const expiresAt = Number(rawExpiresAt);
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt < Date.now() ||
        expiresAt > Date.now() + 24 * 60 * 60_000
      ) {
        return undefined;
      }
    }
    if (!rawServerUrl) return { channelId };

    const serverUrl = new URL(rawServerUrl);
    if (serverUrl.protocol !== "ws:" && serverUrl.protocol !== "wss:") return undefined;
    if (serverUrl.username || serverUrl.password) return undefined;
    serverUrl.hash = "";

    return { channelId, serverUrl: serverUrl.toString() };
  } catch {
    return undefined;
  }
};

export const findDeepLinkInvite = (commandLine: readonly string[]): DeepLinkInvite | undefined => {
  for (const argument of commandLine) {
    if (!argument.toLowerCase().startsWith(`${SHANGHAO_PROTOCOL}://`)) continue;
    const invite = parseDeepLinkInvite(argument);
    if (invite) return invite;
  }
  return undefined;
};

export const isDeepLinkAuthCallback = (rawValue: string): boolean => {
  try {
    const url = new URL(rawValue);
    return (
      url.protocol === `${SHANGHAO_PROTOCOL}:` &&
      url.hostname === "auth" &&
      url.pathname.replace(/\/+$/, "") === "/confirmed"
    );
  } catch {
    return false;
  }
};

export const findDeepLinkAuth = (commandLine: readonly string[]): string | undefined => {
  for (const argument of commandLine) {
    if (!argument.toLowerCase().startsWith(`${SHANGHAO_PROTOCOL}://`)) continue;
    if (isDeepLinkAuthCallback(argument)) return argument;
  }
  return undefined;
};
