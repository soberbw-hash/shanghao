import net from "node:net";

import {
  DEFAULT_ROOM_NAME,
  DEFAULT_SIGNALING_PORT,
  type HostSessionInfo,
  type JoinRoomDiagnostic,
  type RendererLogPayload,
} from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";

import {
  detectTailscaleStatus,
  resolvePreferredHostAddress,
} from "./tailscale";

const FIXED_ROOM_ID = "private-room";
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

export class HostSessionController {
  private server?: SignalingServer;

  constructor(
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  async start(roomName: string, nickname: string): Promise<HostSessionInfo> {
    await this.stop();

    this.server = new SignalingServer({
      port: DEFAULT_SIGNALING_PORT,
      roomName: normalizeRoomName(roomName),
      logger: (message, context) => {
        void this.writeLog({
          category: "signaling",
          level: "info",
          message,
          context,
        });
      },
    });

    try {
      const signalingPort = await this.server.listen();
      const tailscaleStatus = await detectTailscaleStatus();
      const resolvedAddress = await resolvePreferredHostAddress();

      if (!resolvedAddress) {
        throw new Error("无法获取本机连接地址");
      }

      const sessionInfo: HostSessionInfo = {
        roomId: FIXED_ROOM_ID,
        roomName: normalizeRoomName(roomName),
        hostDisplayName: nickname,
        signalingPort,
        signalingUrl: `ws://${resolvedAddress.host}:${signalingPort}`,
        tailscaleIp: tailscaleStatus.ip,
        hostAddress: resolvedAddress.host,
        addressSource: resolvedAddress.source,
        alternativeAddresses: resolvedAddress.alternatives,
      };

      await this.writeLog({
        category: "signaling",
        level: "info",
        message: "Host signaling session started",
        context: { ...sessionInfo },
      });

      return sessionInfo;
    } catch (error) {
      await this.writeLog({
        category: "signaling",
        level: "error",
        message: "Failed to start host signaling session",
        context: {
          roomName: normalizeRoomName(roomName),
          error: error instanceof Error ? error.message : String(error),
        },
      });
      await this.stop();
      throw error;
    }
  }

  async diagnoseJoin(signalingUrl: string): Promise<JoinRoomDiagnostic> {
    const details: string[] = [];
    const tailscaleStatus = await detectTailscaleStatus().catch(() => undefined);

    if (!signalingUrl.trim()) {
      return {
        signalingUrl,
        isUrlValid: false,
        isReachable: false,
        addressSource: "unknown",
        tailscaleState: tailscaleStatus?.state,
        failureStage: "validation",
        message: "没有可用的房间地址。",
        details: [
          "请先粘贴房主分享的地址。",
          ...(tailscaleStatus ? [`Tailscale 状态：${tailscaleStatus.state}`] : []),
        ],
      };
    }

    try {
      const parsed = new URL(signalingUrl);
      const host = parsed.hostname;
      const port = Number(parsed.port || (parsed.protocol === "wss:" ? "443" : "80"));
      const addressSource =
        host.endsWith(".ts.net")
          ? "magicdns"
          : /^100\./.test(host)
            ? "tailscale_ip"
            : "lan_ip";

      details.push(`目标地址：${host}:${port}`);
      if (tailscaleStatus) {
        details.push(`Tailscale 状态：${tailscaleStatus.state}`);
      }

      const isReachable = await probeTcpPort(host, port);
      if (!isReachable) {
        details.push("目标端口没有连通。");
      }

      return {
        signalingUrl,
        host,
        port,
        isUrlValid: true,
        isReachable,
        addressSource,
        tailscaleState: tailscaleStatus?.state,
        failureStage: isReachable ? "websocket" : "network",
        message: isReachable
          ? "地址可达，但连接没有建立成功。"
          : "无法连到房主地址，请检查 Tailscale 或网络环境。",
        details,
      };
    } catch {
      return {
        signalingUrl,
        isUrlValid: false,
        isReachable: false,
        addressSource: "unknown",
        tailscaleState: tailscaleStatus?.state,
        failureStage: "validation",
        message: "房间地址格式不正确。",
        details: [
          "请确认粘贴的是房主发来的完整地址。",
          ...(tailscaleStatus ? [`Tailscale 状态：${tailscaleStatus.state}`] : []),
        ],
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
