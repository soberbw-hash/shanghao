import type { DeepLinkInvite } from "@private-voice/shared";

export const SHANGHAO_PROTOCOL = "shanghao";

const ALLOWED_CHANNEL_IDS = new Set<DeepLinkInvite["channelId"]>(["main", "side"]);

export const parseDeepLinkInvite = (rawValue: string): DeepLinkInvite | undefined => {
  try {
    const url = new URL(rawValue);
    if (url.protocol !== `${SHANGHAO_PROTOCOL}:` || url.hostname !== "join") return undefined;

    const channelId = url.searchParams.get("room") as DeepLinkInvite["channelId"] | null;
    const rawServerUrl = url.searchParams.get("server");
    if (!channelId || !ALLOWED_CHANNEL_IDS.has(channelId) || !rawServerUrl) return undefined;

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
