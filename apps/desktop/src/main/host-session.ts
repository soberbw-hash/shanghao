import net from "node:net";
import { request } from "node:https";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  DEFAULT_ROOM_NAME,
  DEFAULT_SIGNALING_PORT,
  type AppSettings,
  type ConnectionMode,
  type HostSessionInfo,
  type JoinRoomDiagnostic,
  type RendererLogPayload,
} from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";

import { detectProxyDiagnostics } from "./network-diagnostics";
import {
  detectTailscaleStatus,
  resolveLanIpv4Candidates,
  resolveTailscaleAddress,
} from "./tailscale";

const JOIN_DIAGNOSTIC_TIMEOUT_MS = 2_500;

const normalizeRoomName = (roomName: string): string =>
  roomName.trim() || DEFAULT_ROOM_NAME;

const probeTcpPort = async (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(JOIN_DIAGNOSTIC_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });

const detectPublicIp = async (): Promise<string | undefined> =>
  new Promise((resolve) => {
    const req = request("https://api64.ipify.org?format=json", (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { ip?: string };
          resolve(parsed.ip);
        } catch {
          resolve(undefined);
        }
      });
    });

    req.on("error", () => resolve(undefined));
    req.setTimeout(2_500, () => {
      req.destroy();
      resolve(undefined);
    });
    req.end();
  });

const createInviteUrl = ({
  host,
  port,
  roomId,
  mode,
}: {
  host: string;
  port?: number;
  roomId: string;
  mode: ConnectionMode;
}) => {
  const base = port ? `ws://${host}:${port}` : host;
  const url = new URL(base);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("mode", mode);
  url.searchParams.set("protocolVersion", APP_PROTOCOL_VERSION);
  url.searchParams.set("buildNumber", APP_BUILD_NUMBER);
  return url.toString();
};

export class HostSessionController {
  private server?: SignalingServer;

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  async start(
    roomName: string,
    nickname: string,
    connectionMode: ConnectionMode,
  ): Promise<HostSessionInfo> {
    await this.stop();

    const roomId = crypto.randomUUID();
    const normalizedRoomName = normalizeRoomName(roomName);
    const settings = this.getSettings();

    if (connectionMode !== "relay") {
      this.server = new SignalingServer({
        port: DEFAULT_SIGNALING_PORT,
        roomName: normalizedRoomName,
        logger: (message, context) => {
          void this.writeLog({
            category: "signaling",
            level: "info",
            message,
            context,
          });
        },
      });
    }

    try {
      const signalingPort = this.server ? await this.server.listen() : undefined;
      const tailscaleStatus = await detectTailscaleStatus();

      let hostAddress = "";
      let addressSource: HostSessionInfo["addressSource"] = "unknown";
      let alternativeAddresses: string[] = [];

      if (connectionMode === "tailscale") {
        const resolvedAddress = await resolveTailscaleAddress();
        if (!resolvedAddress) {
          throw new Error("Tailscale 模式下没有可用地址，请先连到同一个 tailnet。");
        }
        hostAddress = resolvedAddress.host;
        addressSource = resolvedAddress.source;
        alternativeAddresses = resolvedAddress.alternatives;
      } else if (connectionMode === "direct_host") {
        hostAddress = settings.manualDirectHost || (await detectPublicIp()) || "";
        addressSource = settings.manualDirectHost ? "manual_public_host" : "public_ip";
        alternativeAddresses = resolveLanIpv4Candidates();
        if (!hostAddress) {
          throw new Error("当前不满足公网直连条件，请改用 Tailscale 或云中继模式。");
        }
      } else {
        hostAddress = settings.relayServerUrl?.trim() || "";
        addressSource = "relay";
        alternativeAddresses = [];
        if (!hostAddress) {
          throw new Error("请先在设置里填写可用的中继服务器地址。");
        }
      }

      const signalingUrl = createInviteUrl({
        host: hostAddress,
        port: connectionMode === "relay" ? undefined : signalingPort,
        roomId,
        mode: connectionMode,
      });

      const sessionInfo: HostSessionInfo = {
        roomId,
        roomName: normalizedRoomName,
        hostDisplayName: nickname,
        signalingPort,
        signalingUrl,
        connectionMode,
        tailscaleIp: tailscaleStatus.ip,
        hostAddress,
        addressSource,
        alternativeAddresses,
        protocolVersion: APP_PROTOCOL_VERSION,
        appVersion: appVersion(),
        buildNumber: APP_BUILD_NUMBER,
      };

      await this.writeLog({
        category: "connection-mode",
        level: "info",
        message: "Host session started",
        context: {
          ...sessionInfo,
        },
      });

      return sessionInfo;
    } catch (error) {
      await this.writeLog({
        category: "signaling",
        level: "error",
        message: "Failed to start host signaling session",
        context: {
          roomName: normalizedRoomName,
          connectionMode,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      await this.stop();
      throw error;
    }
  }

  async diagnoseJoin(
    signalingUrl: string,
    connectionMode: ConnectionMode,
  ): Promise<JoinRoomDiagnostic> {
    const details: string[] = [];
    const [tailscaleStatus, proxyDiagnostics] = await Promise.all([
      detectTailscaleStatus().catch(() => undefined),
      detectProxyDiagnostics().catch(() => undefined),
    ]);

    if (!signalingUrl.trim()) {
      return {
        signalingUrl,
        connectionMode,
        isUrlValid: false,
        isReachable: false,
        addressSource: "unknown",
        tailscaleState: tailscaleStatus?.state,
        failureStage: "validation",
        message: "没有可用的房间地址。",
        details: ["请先粘贴房主分享的地址。"],
        proxyDiagnostics,
      };
    }

    try {
      const parsed = new URL(signalingUrl);
      const host = parsed.hostname;
      const port = Number(parsed.port || "80");
      const addressSource =
        connectionMode === "tailscale"
          ? host.endsWith(".ts.net")
            ? "magicdns"
            : "tailscale_ip"
          : connectionMode === "relay"
            ? "relay"
            : "public_ip";

      details.push(`目标地址：${host}:${port}`);
      if (tailscaleStatus) {
        details.push(`Tailscale 状态：${tailscaleStatus.state}`);
      }
      if (proxyDiagnostics) {
        details.push(proxyDiagnostics.message);
      }

      const isReachable = await probeTcpPort(host, port);
      if (!isReachable) {
        details.push("目标端口没有连通。");
      }

      return {
        signalingUrl,
        connectionMode,
        host,
        port,
        isUrlValid: true,
        isReachable,
        addressSource,
        tailscaleState: tailscaleStatus?.state,
        failureStage: isReachable ? "websocket" : "network",
        message: isReachable
          ? "地址已可达，但房间连接握手失败，可能受代理 / TUN 影响。"
          : "无法连接到房主地址。",
        details,
        proxyDiagnostics,
        protocolVersion: parsed.searchParams.get("protocolVersion") ?? undefined,
        buildNumber: parsed.searchParams.get("buildNumber") ?? undefined,
      };
    } catch {
      return {
        signalingUrl,
        connectionMode,
        isUrlValid: false,
        isReachable: false,
        addressSource: "unknown",
        tailscaleState: tailscaleStatus?.state,
        failureStage: "validation",
        message: "房间地址格式不正确。",
        details: ["请确认粘贴的是房主发来的完整地址。"],
        proxyDiagnostics,
      };
    }
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await this.server.close();
    this.server = undefined;
    await this.writeLog({
      category: "signaling",
      level: "info",
      message: "Host signaling session stopped",
    });
  }
}

const appVersion = () => process.env.npm_package_version ?? "0.1.6";
