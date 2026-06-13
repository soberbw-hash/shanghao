import net from "node:net";
import { WebSocket } from "ws";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  type RelayStatusSnapshot,
  type RendererLogPayload,
} from "@private-voice/shared";

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

interface RelayHealthPayload {
  ok?: boolean;
  protocolVersion?: string;
  buildNumber?: string;
  packageVersion?: string;
  uptime?: number;
  activeRooms?: number;
  connectedPeers?: number;
}

const probeHealth = async (url: string): Promise<RelayHealthPayload | undefined> => {
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
      return undefined;
    }
    const payload = (await response.json()) as RelayHealthPayload;
    return payload.ok === true ? payload : undefined;
  } catch {
    return undefined;
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
    const [health, isWebSocketReachable] = tcpReachable
      ? await Promise.all([probeHealth(normalizedUrl), probeWebSocket(normalizedUrl)])
      : [undefined, false];
    const isHealthReachable = Boolean(health);
    const hasVersionMismatch = Boolean(
      (health?.protocolVersion && health.protocolVersion !== APP_PROTOCOL_VERSION) ||
      (health?.buildNumber && health.buildNumber !== APP_BUILD_NUMBER),
    );

    // WebSocket is the real signaling path. A missing /health endpoint should
    // warn the user, but must not reject an otherwise usable relay.
    const isReachable = isWebSocketReachable;
    const result: RelayStatusSnapshot = {
      serverUrl: normalizedUrl,
      isConfigured: true,
      isReachable,
      isHealthReachable,
      isWebSocketReachable,
      protocolVersion: health?.protocolVersion,
      buildNumber: health?.buildNumber,
      packageVersion: health?.packageVersion,
      uptime: health?.uptime,
      activeRooms: health?.activeRooms,
      connectedPeers: health?.connectedPeers,
      hasVersionMismatch,
      lastCheckedAt: new Date().toISOString(),
      message: isReachable
        ? hasVersionMismatch
          ? `服务器版本 ${health?.protocolVersion ?? "未知"} / ${health?.buildNumber ?? "未知"} 与客户端 ${APP_PROTOCOL_VERSION} / ${APP_BUILD_NUMBER} 不一致，请更新中继服务。`
          : isHealthReachable
          ? `服务器可用，协议 ${health?.protocolVersion ?? "未知"}，构建 ${health?.buildNumber ?? "未知"}，客户端构建 ${APP_BUILD_NUMBER}。`
          : "服务器可连接，但 /health 返回异常；WebSocket 可正常使用。"
        : tcpReachable
          ? isHealthReachable
            ? "服务器健康检查正常，但 WebSocket 无法打开。"
            : "服务器端口可达，但 /health 与 WebSocket 均不可用。"
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
