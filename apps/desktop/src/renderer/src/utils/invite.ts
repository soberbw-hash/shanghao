import type { HostSessionInfo } from "@private-voice/shared";

const VALID_CONNECTION_MODES = new Set([
  "cloudflare_tunnel",
  "relay",
  "tailscale",
  "direct_host",
]);

const formatHostForUrl = (host: string): string => {
  const trimmed = host.trim();
  if (trimmed.includes(":") && !trimmed.startsWith("[") && !trimmed.endsWith("]")) {
    return `[${trimmed}]`;
  }

  return trimmed;
};

const appendInviteMetadata = (url: URL, session: HostSessionInfo): URL => {
  url.searchParams.set("roomId", session.roomId);
  url.searchParams.set("mode", session.connectionMode);
  url.searchParams.set("protocolVersion", session.protocolVersion);
  url.searchParams.set("buildNumber", session.buildNumber);
  return url;
};

const createInviteUrlForHost = (session: HostSessionInfo, host: string): string => {
  const hasPort = typeof session.signalingPort === "number" && session.signalingPort > 0;
  const base =
    session.connectionMode === "relay"
      ? host
      : `ws://${formatHostForUrl(host)}:${session.signalingPort}`;

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
    if (session.connectionMode === "direct_host") {
      return url.toString();
    }

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

export const isValidInviteUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    const mode = url.searchParams.get("mode");
    const hasRequiredMetadata =
      Boolean(url.searchParams.get("roomId")) &&
      Boolean(url.searchParams.get("protocolVersion")) &&
      Boolean(url.searchParams.get("buildNumber"));
    const isCloudflareTunnelValid =
      mode !== "cloudflare_tunnel" || url.protocol === "wss:";

    return (
      (url.protocol === "ws:" || url.protocol === "wss:") &&
      hasRequiredMetadata &&
      Boolean(mode && VALID_CONNECTION_MODES.has(mode)) &&
      isCloudflareTunnelValid
    );
  } catch {
    return false;
  }
};

export const buildShareableInviteUrl = (session?: HostSessionInfo): string => {
  if (!session) {
    return "";
  }

  if (
    session.connectionMode === "direct_host" &&
    (session.directHostProbe?.reachability !== "reachable" ||
      session.directHostProbe.addressSource === "lan_ipv4")
  ) {
    return "";
  }

  if (
    session.connectionMode === "cloudflare_tunnel" &&
    session.cloudflareTunnel?.processState !== "active"
  ) {
    return "";
  }

  if (session.signalingUrl?.trim()) {
    const inviteUrl = withCandidateUrls(session.signalingUrl, session);
    return isValidInviteUrl(inviteUrl) ? inviteUrl : "";
  }

  if (!session.hostAddress?.trim()) {
    return "";
  }

  const inviteUrl = withCandidateUrls(createInviteUrlForHost(session, session.hostAddress), session);
  return isValidInviteUrl(inviteUrl) ? inviteUrl : "";
};
