import net from "node:net";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  DEFAULT_ROOM_NAME,
  DEFAULT_SIGNALING_PORT,
  HostSessionState,
  type AppSettings,
  type ConnectionMode,
  type HostSessionInfo,
  type JoinRoomDiagnostic,
  type RendererLogPayload,
} from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";

import { probeDirectHost } from "./direct-host";
import { detectProxyDiagnostics } from "./network-diagnostics";
import { readRelayStatus } from "./relay-status";
import {
  detectTailscaleStatus,
  resolveLanIpv4Candidates,
  resolveTailscaleAddress,
} from "./tailscale";

const JOIN_DIAGNOSTIC_TIMEOUT_MS = 2_500;

const appVersion = (): string => process.env.npm_package_version ?? "0.0.0";

const normalizeRoomName = (roomName: string): string => roomName.trim() || DEFAULT_ROOM_NAME;

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

const createInviteUrl = ({
  host,
  port,
  roomId,
  mode,
  relayToken,
}: {
  host: string;
  port?: number;
  roomId: string;
  mode: ConnectionMode;
  relayToken?: string;
}) => {
  const base = port ? `ws://${host}:${port}` : host;
  const url = new URL(base);
  url.searchParams.set("roomId", roomId);
  url.searchParams.set("mode", mode);
  url.searchParams.set("protocolVersion", APP_PROTOCOL_VERSION);
  url.searchParams.set("buildNumber", APP_BUILD_NUMBER);
  if (relayToken) {
    url.searchParams.set("relayToken", relayToken);
  }
  return url.toString();
};

export class HostSessionController {
  private server?: SignalingServer;
  private cleanupTasks: Array<() => Promise<void>> = [];
  private currentSession?: HostSessionInfo;

  constructor(
    private readonly getSettings: () => AppSettings,
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  getSnapshot(): HostSessionInfo | undefined {
    return this.currentSession;
  }

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
      let directHostProbe: HostSessionInfo["directHostProbe"];
      let relayStatus: HostSessionInfo["relayStatus"];
      const relayToken =
        connectionMode === "relay" ? settings.relayAuthToken || crypto.randomUUID() : undefined;

      if (connectionMode === "tailscale") {
        const resolvedAddress = await resolveTailscaleAddress();
        if (!resolvedAddress) {
          throw new Error("Tailscale 模式下没有可用地址，请先连接到同一个 tailnet。");
        }
        hostAddress = resolvedAddress.host;
        addressSource = resolvedAddress.source;
        alternativeAddresses = resolvedAddress.alternatives;
      } else if (connectionMode === "direct_host") {
        const probe = await probeDirectHost({
          localPort: signalingPort ?? DEFAULT_SIGNALING_PORT,
          manualHost: settings.manualDirectHost,
          writeLog: this.writeLog,
        });
        this.cleanupTasks = probe.cleanupTasks;
        directHostProbe = probe.summary;
        hostAddress = probe.summary.selectedHost || "";
        addressSource = probe.summary.addressSource;
        alternativeAddresses = resolveLanIpv4Candidates();

        if (!hostAddress) {
          throw new Error("当前网络不支持房主直连，请改用 Tailscale 或云中继模式。");
        }
      } else {
        relayStatus = await readRelayStatus({
          relayServerUrl: settings.relayServerUrl,
          writeLog: this.writeLog,
        });
        if (!relayStatus.isConfigured) {
          throw new Error("请先在设置里填写可用的云中继地址。");
        }
        if (!relayStatus.serverUrl) {
          throw new Error("云中继地址无效，请到设置里重新填写。");
        }

        hostAddress = relayStatus.serverUrl;
        addressSource = "relay";
        alternativeAddresses = [];
      }

      const signalingUrl = createInviteUrl({
        host: hostAddress,
        port: connectionMode === "relay" ? undefined : signalingPort,
        roomId,
        mode: connectionMode,
        relayToken,
      });

      const sessionInfo: HostSessionInfo = {
        roomId,
        roomName: normalizedRoomName,
        hostDisplayName: nickname,
        signalingPort,
        signalingUrl,
        connectionMode,
        hostState: HostSessionState.Active,
        tailscaleIp: tailscaleStatus.ip,
        hostAddress,
        addressSource,
        alternativeAddresses,
        protocolVersion: APP_PROTOCOL_VERSION,
        appVersion: appVersion(),
        buildNumber: APP_BUILD_NUMBER,
        directHostProbe,
        relayStatus,
        inviteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      };

      this.currentSession = sessionInfo;

      await this.writeLog({
        category: connectionMode === "relay" ? "relay" : "connection-mode",
        level: "info",
        message: "host session started",
        context: sessionInfo as unknown as Record<string, unknown>,
      });

      return sessionInfo;
    } catch (error) {
      await this.writeLog({
        category: connectionMode === "relay" ? "relay" : "signaling",
        level: "error",
        message: "failed to start host signaling session",
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
        details: ["请先粘贴房主分享的完整地址。"],
        proxyDiagnostics,
      };
    }

    try {
      const parsed = new URL(signalingUrl);
      const host = parsed.hostname;
      const port = Number(parsed.port || (parsed.protocol === "wss:" ? "443" : "80"));
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

      const relayStatus =
        connectionMode === "relay"
          ? await readRelayStatus({
              relayServerUrl: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
              writeLog: this.writeLog,
            }).catch(() => undefined)
          : undefined;

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
          ? "地址已可达，但房间连接握手失败，可能受代理/TUN 影响。"
          : "无法连接到房主地址。",
        details,
        proxyDiagnostics,
        protocolVersion: parsed.searchParams.get("protocolVersion") ?? undefined,
        buildNumber: parsed.searchParams.get("buildNumber") ?? undefined,
        relayStatus,
      };
    } catch (error) {
      return {
        signalingUrl,
        connectionMode,
        isUrlValid: false,
        isReachable: false,
        addressSource: "unknown",
        tailscaleState: tailscaleStatus?.state,
        failureStage: "validation",
        message: "连接地址格式不正确。",
        details: [error instanceof Error ? error.message : String(error)],
        proxyDiagnostics,
      };
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      try {
        await this.server.close();
      } catch {
        // noop
      }
      this.server = undefined;
    }

    for (const cleanup of this.cleanupTasks.splice(0)) {
      await cleanup().catch(() => undefined);
    }

    this.currentSession = undefined;
  }
}
