import {
  DEFAULT_ROOM_NAME,
  type HostSessionInfo,
  type RendererLogPayload,
} from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";

import { detectTailscaleStatus, resolvePreferredHostIp } from "./tailscale";

const FIXED_ROOM_ID = "private-room";

export class HostSessionController {
  private server?: SignalingServer;

  constructor(
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  async start(roomName: string, nickname: string): Promise<HostSessionInfo> {
    await this.stop();

    this.server = new SignalingServer({
      roomName: roomName || DEFAULT_ROOM_NAME,
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
      const hostIp = await resolvePreferredHostIp();

      if (!hostIp) {
        throw new Error("无法获取本机连接地址");
      }

      const sessionInfo: HostSessionInfo = {
        roomId: FIXED_ROOM_ID,
        roomName: roomName || DEFAULT_ROOM_NAME,
        hostDisplayName: nickname,
        signalingPort,
        signalingUrl: `ws://${hostIp}:${signalingPort}`,
        tailscaleIp: tailscaleStatus.ip,
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
          roomName: roomName || DEFAULT_ROOM_NAME,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      await this.stop();
      throw error;
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
