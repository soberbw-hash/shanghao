import { APP_BUILD_NUMBER } from "@private-voice/shared";

export interface PhoneMicHealth {
  ok: boolean;
  status: "ok" | "degraded";
  version: string;
  buildNumber: string;
  activeSessions: number;
  uptimeSeconds: number;
  relayReady: boolean;
}

export const readPhoneMicHealth = async (options: {
  relayPort: number;
  activeSessions: number;
  startedAt: number;
  version: string;
}): Promise<PhoneMicHealth> => {
  let relayReady = false;
  try {
    const response = await fetch(`http://127.0.0.1:${options.relayPort}/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    relayReady = response.ok;
    await response.body?.cancel();
  } catch {
    // The sidecar can still answer diagnostics while the account relay is down.
  }
  return {
    ok: relayReady,
    status: relayReady ? "ok" : "degraded",
    version: options.version,
    buildNumber: APP_BUILD_NUMBER,
    activeSessions: options.activeSessions,
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - options.startedAt) / 1_000)),
    relayReady,
  };
};
