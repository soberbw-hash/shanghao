import type { HostSessionInfo } from "@private-voice/shared";

const appendInviteMetadata = (url: URL, session: HostSessionInfo): URL => {
  url.searchParams.set("roomId", session.roomId);
  url.searchParams.set("mode", session.connectionMode);
  url.searchParams.set("protocolVersion", session.protocolVersion);
  url.searchParams.set("buildNumber", session.buildNumber);
  return url;
};

const createInviteUrlForHost = (session: HostSessionInfo, host: string): string => {
  const hasPort = typeof session.signalingPort === "number" && session.signalingPort > 0;
  const base = session.connectionMode === "relay" ? host : `ws://${host}:${session.signalingPort}`;

  if (!hasPort && session.connectionMode !== "relay") {
    return "";
  }

  try {
    return appendInviteMetadata(new URL(base), session).toString();
  } catch {
    return "";
  }
};

const withCandidateUrls = (mainInviteUrl: string, session: HostSessionInfo): string => {
  if (!mainInviteUrl) {
    return "";
  }

  try {
    const url = new URL(mainInviteUrl);
    const seen = new Set([url.toString()]);
    for (const address of session.alternativeAddresses ?? []) {
      const candidate = createInviteUrlForHost(session, address);
      if (candidate && !seen.has(candidate)) {
        seen.add(candidate);
        url.searchParams.append("candidate", candidate);
      }
    }
    return url.toString();
  } catch {
    return mainInviteUrl;
  }
};

export const buildShareableInviteUrl = (session?: HostSessionInfo): string => {
  if (!session) {
    return "";
  }

  if (session.signalingUrl?.trim()) {
    return withCandidateUrls(session.signalingUrl, session);
  }

  if (!session.hostAddress?.trim()) {
    return "";
  }

  return withCandidateUrls(createInviteUrlForHost(session, session.hostAddress), session);
};
