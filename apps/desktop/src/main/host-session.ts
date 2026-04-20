import { EventEmitter } from "node:events";
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

const createLocalJoinUrl = ({
  roomId,
  port,
  mode,
  relayToken,
}: {
  roomId: string;
  port: number;
  mode: ConnectionMode;
  relayToken?: string;
}) =>
  createInviteUrl({
    host: "127.0.0.1",
    port,
    roomId,
    mode,
    relayToken,
  });

const createPendingDirectProbe = (
  localPort: number,
  manualHost?: string,
): HostSessionInfo["directHostProbe"] => ({
  publicIp: undefined,
  manualHost,
  selectedHost: manualHost,
  selectedPort: localPort,
  addressSource: manualHost ? "manual_public_host" : "unknown",
  upnpAttempted: false,
  upnpMapped: false,
  natPmpAttempted: false,
  natPmpMapped: false,
  reachability: "pending",
  natTendency: "unknown",
  message: manualHost
    ? "房间已启动，正在验证你填写的公网地址是否可分享。"
    : "房间已启动，正在检测公网直连能力。",
});

export class HostSessionController {
  private readonly events = new EventEmitter();
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

  onUpdate(listener: (session?: HostSessionInfo) => void): () => void {
    this.events.on("update", listener);
    return () => {
      this.events.off("update", listener);
    };
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
      const relayToken =
        connectionMode === "relay" ? settings.relayAuthToken || crypto.randomUUID() : undefined;

      let hostAddress = "";
      let signalingUrl = "";
      let addressSource: HostSessionInfo["addressSource"] = "unknown";
      let alternativeAddresses: string[] = [];
      let directHostProbe: HostSessionInfo["directHostProbe"];
      let relayStatus: HostSessionInfo["relayStatus"];

      if (connectionMode === "tailscale") {
        const resolvedAddress = await resolveTailscaleAddress();
        if (!resolvedAddress || !signalingPort) {
          throw new Error("Tailscale 当前不可用，请先连接到同一个 tailnet。");
        }

        hostAddress = resolvedAddress.host;
        addressSource = resolvedAddress.source;
        alternativeAddresses = resolvedAddress.alternatives;
        signalingUrl = createInviteUrl({
          host: hostAddress,
          port: signalingPort,
          roomId,
          mode: connectionMode,
          relayToken,
        });
      } else if (connectionMode === "direct_host") {
        if (!signalingPort) {
          throw new Error("房间启动失败，未拿到可用的 signaling 端口。");
        }

        const manualHost = settings.manualDirectHost?.trim() || undefined;
        hostAddress = manualHost ?? "";
        addressSource = manualHost ? "manual_public_host" : "unknown";
        alternativeAddresses = resolveLanIpv4Candidates();
        directHostProbe = createPendingDirectProbe(signalingPort, manualHost);
        signalingUrl = manualHost
          ? createInviteUrl({
              host: manualHost,
              port: signalingPort,
              roomId,
              mode: connectionMode,
            })
          : "";
      } else {
        relayStatus = await readRelayStatus({
          relayServerUrl: settings.relayServerUrl,
          writeLog: this.writeLog,
        });

        if (!relayStatus.isConfigured) {
          throw new Error("请先在设置里填好可用的云中继地址。");
        }

        if (!relayStatus.serverUrl) {
          throw new Error("云中继地址无效，请重新填写。");
        }

        hostAddress = relayStatus.serverUrl;
        addressSource = "relay";
        signalingUrl = createInviteUrl({
          host: hostAddress,
          roomId,
          mode: connectionMode,
          relayToken,
        });
      }

      const localSignalingUrl =
        connectionMode === "relay" || !signalingPort
          ? signalingUrl
          : createLocalJoinUrl({
              roomId,
              port: signalingPort,
              mode: connectionMode,
              relayToken,
            });

      const sessionInfo: HostSessionInfo = {
        roomId,
        roomName: normalizedRoomName,
        hostDisplayName: nickname,
        signalingPort,
        signalingUrl,
        localSignalingUrl,
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
      this.emitUpdate();

      await this.writeLog({
        category: connectionMode === "relay" ? "relay" : "connection-mode",
        level: "info",
        message:
          connectionMode === "direct_host"
            ? "host session started locally"
            : "host session started",
        context: {
          ...sessionInfo,
          joinMode: connectionMode === "direct_host" ? "loopback-for-host" : "default",
        } as Record<string, unknown>,
      });

      if (connectionMode === "direct_host" && signalingPort) {
        void this.runDirectHostProbe({
          roomId,
          localPort: signalingPort,
          manualHost: settings.manualDirectHost,
        });
      }

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

  private async runDirectHostProbe({
    roomId,
    localPort,
    manualHost,
  }: {
    roomId: string;
    localPort: number;
    manualHost?: string;
  }): Promise<void> {
    await this.writeLog({
      category: "connection-mode",
      level: "info",
      message: "direct host probe started",
      context: {
        roomId,
        localPort,
        manualHost: manualHost?.trim() || undefined,
      },
    });

    try {
      const probe = await probeDirectHost({
        localPort,
        manualHost,
        writeLog: this.writeLog,
      });

      if (!this.currentSession || this.currentSession.roomId !== roomId) {
        for (const cleanup of probe.cleanupTasks) {
          await cleanup().catch(() => undefined);
        }
        return;
      }

      this.cleanupTasks.push(...probe.cleanupTasks);

      const hasCandidateAddress = Boolean(probe.summary.selectedHost);
      const isVerifiedShareable = probe.summary.reachability === "reachable";
      const hostAddress = hasCandidateAddress ? probe.summary.selectedHost || "" : "";
      const signalingUrl =
        hasCandidateAddress && hostAddress
          ? createInviteUrl({
              host: hostAddress,
              port: localPort,
              roomId,
              mode: "direct_host",
            })
          : "";

      this.currentSession = {
        ...this.currentSession,
        signalingUrl,
        hostAddress,
        addressSource: hasCandidateAddress ? probe.summary.addressSource : "unknown",
        alternativeAddresses: resolveLanIpv4Candidates(),
        directHostProbe: probe.summary,
      };
      this.emitUpdate();

      await this.writeLog({
        category: "connection-mode",
        level: isVerifiedShareable ? "info" : hasCandidateAddress ? "warn" : "error",
        message: "direct host probe finalized",
        context: {
          roomId,
          hostAddress,
          signalingUrl,
          reachability: probe.summary.reachability,
          natTendency: probe.summary.natTendency,
          upnpMapped: probe.summary.upnpMapped,
          natPmpMapped: probe.summary.natPmpMapped,
          hasCandidateAddress,
          isVerifiedShareable,
        },
      });
    } catch (error) {
      if (!this.currentSession || this.currentSession.roomId !== roomId) {
        return;
      }

      this.currentSession = {
        ...this.currentSession,
        signalingUrl: "",
        hostAddress: "",
        addressSource: "unknown",
        directHostProbe: {
          publicIp: undefined,
          manualHost: manualHost?.trim() || undefined,
          selectedHost: undefined,
          selectedPort: localPort,
          addressSource: "unknown",
          upnpAttempted: false,
          upnpMapped: false,
          natPmpAttempted: false,
          natPmpMapped: false,
          reachability: "unreachable",
          natTendency: "unknown",
          message: "房间本地已启动，但当前网络拿不到可分享地址，建议改用 Tailscale 或云中继。",
        },
      };
      this.emitUpdate();

      await this.writeLog({
        category: "connection-mode",
        level: "error",
        message: "direct host probe failed",
        context: {
          roomId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
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
        details.push(`Tailscale：${tailscaleStatus.state}`);
      }
      if (proxyDiagnostics) {
        details.push(proxyDiagnostics.message);
      }

      const isReachable = await probeTcpPort(host, port);
      if (!isReachable) {
        details.push("目标端口当前不可达。");
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
          ? "地址已可达，但房间连接握手失败，可能受代理或 TUN 影响。"
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
    this.emitUpdate();
  }

  private emitUpdate(): void {
    this.events.emit("update", this.currentSession);
  }
}
