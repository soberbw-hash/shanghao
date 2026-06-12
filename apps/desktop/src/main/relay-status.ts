import net from "node:net";
import { WebSocket } from "ws";

import type { RelayStatusSnapshot, RendererLogPayload } from "@private-voice/shared";

import { normalizeRelayServerUrl } from "./relay-url";

const probePort = async (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(2_500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });

const probeWebSocket = async (url: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new WebSocket(url, { handshakeTimeout: 4_000 });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      socket.close();
      resolve(result);
    };
    socket.once("open", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });

const probeHealth = async (url: string): Promise<boolean> => {
  const healthUrl = new URL(url);
  healthUrl.protocol = healthUrl.protocol === "wss:" ? "https:" : "http:";
  healthUrl.pathname = "/health";
  healthUrl.search = "";
  healthUrl.hash = "";

  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as { ok?: unknown };
    return payload.ok === true;
  } catch {
    return false;
  }
};

export const readRelayStatus = async ({
  relayServerUrl,
  writeLog,
}: {
  relayServerUrl?: string;
  writeLog?: (payload: RendererLogPayload) => Promise<void>;
}): Promise<RelayStatusSnapshot> => {
  const normalizedUrl = normalizeRelayServerUrl(relayServerUrl);
  if (!normalizedUrl) {
    return {
      isConfigured: false,
      isReachable: false,
      message: "还没有填写云中继地址。",
    };
  }

  try {
    const parsed = new URL(normalizedUrl);
    const port = Number(parsed.port || (parsed.protocol === "wss:" ? "443" : "80"));
    const tcpReachable = await probePort(parsed.hostname, port);
    const [isHealthReachable, isWebSocketReachable] = tcpReachable
      ? await Promise.all([probeHealth(normalizedUrl), probeWebSocket(normalizedUrl)])
      : [false, false];
    const isReachable = isHealthReachable && isWebSocketReachable;
    const result: RelayStatusSnapshot = {
      serverUrl: normalizedUrl,
      isConfigured: true,
      isReachable,
      isHealthReachable,
      isWebSocketReachable,
      lastCheckedAt: new Date().toISOString(),
      message: isReachable
        ? "云中继健康检查与 WebSocket 均正常，可以用于开房。"
        : tcpReachable
          ? !isHealthReachable
            ? "服务器端口可达，但 /health 健康检查失败。"
            : "服务器健康检查正常，但 WebSocket 无法打开。"
          : "云中继地址当前不可达。",
    };

    await writeLog?.({
      category: "relay",
      level: isReachable ? "info" : "warn",
      message: "relay status checked",
      context: result as unknown as Record<string, unknown>,
    });

    return result;
  } catch (error) {
    await writeLog?.({
      category: "relay",
      level: "warn",
      message: "relay status check failed",
      context: {
        relayServerUrl: normalizedUrl,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return {
      serverUrl: normalizedUrl,
      isConfigured: true,
      isReachable: false,
      lastCheckedAt: new Date().toISOString(),
      message: "云中继地址格式不正确。",
    };
  }
};
