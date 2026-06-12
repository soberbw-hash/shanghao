import os from "node:os";
import path from "node:path";

import { SignalingServer } from "@private-voice/signaling";
import WebSocket from "ws";

import cloudflareTunnelModule from "../src/main/cloudflare-tunnel";

const { CloudflareTunnelController } = cloudflareTunnelModule;

const server = new SignalingServer({ roomName: "ShangHao tunnel check" });
const port = await server.listen();
const controller = new CloudflareTunnelController(
  path.join(os.tmpdir(), "shanghao-cloudflared-test"),
  async (payload) => {
    console.log(`[${payload.level}] ${payload.message}`, payload.context ?? "");
  },
);

try {
  const status = await controller.start(port);
  if (!status.tunnelUrl) {
    throw new Error("No tunnel URL returned");
  }

  const websocketUrl = status.tunnelUrl.replace(/^https:/, "wss:");
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    const timer = setTimeout(() => reject(new Error("Tunnel WebSocket open timeout")), 15_000);
    socket.once("open", () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    });
    socket.once("error", (error) => reject(error));
  });
  console.log(`Cloudflare tunnel WebSocket verified: ${websocketUrl}`);
} finally {
  await controller.stop();
  await server.close();
}
