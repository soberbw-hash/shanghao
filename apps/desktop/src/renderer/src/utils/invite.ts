import type { HostSessionInfo } from "@private-voice/shared";

export const buildShareableInviteUrl = (session?: HostSessionInfo): string => {
  if (!session) {
    return "";
  }

  if (session.signalingUrl?.trim()) {
    return session.signalingUrl;
  }

  if (!session.hostAddress?.trim()) {
    return "";
  }

  const hasPort = typeof session.signalingPort === "number" && session.signalingPort > 0;
  if (!hasPort && session.connectionMode !== "relay") {
    return "";
  }

  const base =
    session.connectionMode === "relay"
      ? session.hostAddress
      : `ws://${session.hostAddress}:${session.signalingPort}`;

  try {
    const url = new URL(base);
    url.searchParams.set("roomId", session.roomId);
    url.searchParams.set("mode", session.connectionMode);
    url.searchParams.set("protocolVersion", session.protocolVersion);
    url.searchParams.set("buildNumber", session.buildNumber);
    return url.toString();
  } catch {
    return "";
  }
};
