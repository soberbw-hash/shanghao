import net from "node:net";

import type { RelayStatusSnapshot, RendererLogPayload } from "@private-voice/shared";

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

export const readRelayStatus = async ({
  relayServerUrl,
  writeLog,
}: {
  relayServerUrl?: string;
  writeLog?: (payload: RendererLogPayload) => Promise<void>;
}): Promise<RelayStatusSnapshot> => {
  const normalizedUrl = relayServerUrl?.trim();
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
    const isReachable = await probePort(parsed.hostname, port);
    const result: RelayStatusSnapshot = {
      serverUrl: normalizedUrl,
      isConfigured: true,
      isReachable,
      lastCheckedAt: new Date().toISOString(),
      message: isReachable ? "云中继地址可连接。" : "云中继地址当前不可达。",
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
