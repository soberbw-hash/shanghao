export const normalizeRelayServerUrl = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  let candidate = trimmed;
  if (/^https:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^https:\/\//i, "wss://");
  } else if (/^http:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^http:\/\//i, "ws://");
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `ws://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return undefined;
    }

    if (url.pathname === "/health") {
      url.pathname = "/";
    }

    return url.toString();
  } catch {
    return undefined;
  }
};
