import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";

import { PHONE_MIC_USB_PAGE } from "./phone-mic-usb-page";

export interface PhoneMicUsbDevice {
  serial: string;
  label: string;
}
export interface PhoneMicUsbSession {
  url: string;
  receiverUrl: string;
  serial: string;
}

const adbPath = (): string => {
  const candidate = path.join(
    process.env.LOCALAPPDATA ?? "",
    "Microsoft",
    "WinGet",
    "Packages",
    "Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "platform-tools",
    "adb.exe",
  );
  return existsSync(candidate) ? candidate : "adb";
};

const runAdb = (args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(adbPath(), args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let error = "";
    const timeout = setTimeout(() => child.kill(), 8_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString().slice(0, 8_192);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      error += chunk.toString().slice(0, 8_192);
    });
    child.once("error", (cause) => {
      clearTimeout(timeout);
      reject(cause);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output);
      else reject(new Error(error.trim() || `ADB 退出码 ${code ?? "未知"}`));
    });
  });

export const listPhoneMicUsbDevices = async (
  adb: (args: string[]) => Promise<string> = runAdb,
): Promise<PhoneMicUsbDevice[]> => {
  let output: string;
  try {
    output = await adb(["devices", "-l"]);
  } catch {
    throw new Error("没有找到 ADB。请安装 Android SDK Platform-Tools，并重新启动上号。");
  }
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const match = line.match(/^(\S+)\s+(device|unauthorized|offline)\b(.*)$/);
      if (!match || match[2] !== "device") return undefined;
      const model = (match[3] ?? "").match(/\bmodel:(\S+)/)?.[1]?.replaceAll("_", " ");
      return { serial: match[1], label: model ? `${model} (${match[1]})` : match[1] };
    })
    .filter((device): device is PhoneMicUsbDevice => Boolean(device));
};

const sameSecret = (actual: string, expected: string): boolean => {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Only owns one loopback server and its own ADB reverse mapping. Never kills the ADB daemon. */
export class PhoneMicUsbService {
  private transition: Promise<void> = Promise.resolve();
  private server?: Server;
  private socketServer?: WebSocketServer;
  private sender?: WebSocket;
  private receiver?: WebSocket;
  private port?: number;
  private serial?: string;
  private secret?: string;

  constructor(private readonly adb: (args: string[]) => Promise<string> = runAdb) {}

  start(serial?: string): Promise<PhoneMicUsbSession> {
    const operation = this.transition.then(() => this.startInternal(serial));
    this.transition = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async startInternal(serial?: string): Promise<PhoneMicUsbSession> {
    await this.stopInternal();
    const devices = await listPhoneMicUsbDevices(this.adb);
    const selected =
      devices.find((device) => device.serial === serial) ?? (!serial ? devices[0] : undefined);
    if (!selected)
      throw new Error(
        devices.length
          ? "找不到选中的 Android 设备"
          : "未检测到已授权的 Android USB 设备。请开启 USB 调试，并在手机上允许此电脑。",
      );
    const secret = randomBytes(24).toString("base64url");
    const server = createServer((request, response) => {
      if (request.url?.split("?")[0] !== "/usb") {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; connect-src ws://localhost:* ws://127.0.0.1:*; media-src 'self';",
        })
        .end(PHONE_MIC_USB_PAGE);
    });
    const sockets = new WebSocketServer({
      noServer: true,
      maxPayload: 2_048,
      perMessageDeflate: false,
    });
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/usb/ws" || !sameSecret(url.searchParams.get("code") ?? "", secret)) {
        socket.destroy();
        return;
      }
      const role = url.searchParams.get("role");
      if (role !== "sender" && role !== "receiver") {
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (client) => {
        const previous = role === "sender" ? this.sender : this.receiver;
        previous?.close(1000, "replaced");
        if (role === "sender") this.sender = client;
        else this.receiver = client;
        client.on("message", (data, isBinary) => {
          const size = Array.isArray(data)
            ? data.reduce((total, part) => total + part.byteLength, 0)
            : data.byteLength;
          if (role !== "sender" || !isBinary || size !== 1_928) return;
          if (this.receiver?.readyState === WebSocket.OPEN && this.receiver.bufferedAmount < 24_000)
            this.receiver.send(data, { binary: true });
        });
        client.on("close", () => {
          const activeSenderClosed = role === "sender" && this.sender === client;
          if (activeSenderClosed) this.sender = undefined;
          if (role === "receiver" && this.receiver === client) this.receiver = undefined;
          if (activeSenderClosed && this.receiver?.readyState === WebSocket.OPEN)
            this.receiver.send(JSON.stringify({ type: "sender_disconnected" }));
        });
        if (role === "sender" && this.receiver?.readyState === WebSocket.OPEN)
          this.receiver.send(JSON.stringify({ type: "sender_connected" }));
        if (role === "receiver" && this.sender?.readyState === WebSocket.OPEN)
          client.send(JSON.stringify({ type: "sender_connected" }));
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("本地 USB 服务端口不可用");
      this.server = server;
      this.socketServer = sockets;
      this.port = address.port;
      this.serial = selected.serial;
      this.secret = secret;
      await this.adb([
        "-s",
        selected.serial,
        "reverse",
        `tcp:${address.port}`,
        `tcp:${address.port}`,
      ]);
      return {
        url: `http://localhost:${address.port}/usb#code=${encodeURIComponent(secret)}`,
        receiverUrl: `ws://127.0.0.1:${address.port}/usb/ws?role=receiver&code=${encodeURIComponent(secret)}`,
        serial: selected.serial,
      };
    } catch (error) {
      await this.stopInternal();
      throw error;
    }
  }

  stop(): Promise<void> {
    const operation = this.transition.then(() => this.stopInternal());
    this.transition = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async stopInternal(): Promise<void> {
    const port = this.port;
    const serial = this.serial;
    this.port = undefined;
    this.serial = undefined;
    this.secret = undefined;
    this.sender?.terminate();
    this.receiver?.terminate();
    this.sender = undefined;
    this.receiver = undefined;
    this.socketServer?.close();
    this.socketServer = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (port && serial) {
      try {
        await this.adb(["-s", serial, "reverse", "--remove", `tcp:${port}`]);
      } catch {
        /* Device may already be unplugged; never touch other mappings. */
      }
    }
  }
}
