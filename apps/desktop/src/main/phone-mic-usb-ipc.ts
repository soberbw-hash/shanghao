import { app, ipcMain } from "electron";
import { IPC_CHANNELS } from "@private-voice/shared";
import { PhoneMicUsbService, listPhoneMicUsbDevices } from "./phone-mic-usb-service";
import type { AccountDesktopService } from "./account-service";
import type { SettingsStore } from "./settings-store";

export const registerPhoneMicUsbIpc = (
  accounts: AccountDesktopService,
  settings: SettingsStore,
): void => {
  const service = new PhoneMicUsbService();
  ipcMain.handle(IPC_CHANNELS.audio.getPhoneMicHostTicket, async (_event, relayUrl: string) => {
    const configuredUrl = settings.getSnapshot().relayServerUrl;
    if (!configuredUrl) throw new Error("请先设置中继服务器");
    const requested = new URL(relayUrl);
    const configured = new URL(configuredUrl);
    if (requested.origin !== configured.origin || !["ws:", "wss:"].includes(requested.protocol)) {
      throw new Error("手机麦克风只能使用当前配置的中继服务器");
    }
    const accessToken = await accounts.getFreshAccessToken();
    if (!accessToken) throw new Error("请先登录上号账号");
    const local = ["localhost", "127.0.0.1"].includes(requested.hostname);
    requested.protocol = local && requested.protocol === "ws:" ? "http:" : "https:";
    if (!local) requested.port = "";
    requested.pathname = "/phone-mic/ticket";
    requested.search = "";
    requested.hash = "";
    let response: Response;
    try {
      response = await fetch(requested, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new Error(
        "手机麦克风安全配对服务无法连接。请检查中继服务器的 443/HTTPS 和证书；USB 模式可直接连接 Android。",
      );
    }
    if (response.status === 404) throw new Error("中继服务器尚未部署手机麦克风接口。");
    if (response.status === 401 || response.status === 403) {
      throw new Error("手机麦克风授权失败，请重新登录上号账号。");
    }
    if (!response.ok) throw new Error("手机麦克风配对服务暂时不可用，请稍后重试。");
    const body = (await response.json()) as { ticket?: unknown };
    if (typeof body.ticket !== "string" || !/^[0-9a-f]{64}$/.test(body.ticket)) {
      throw new Error("手机麦克风授权响应无效");
    }
    return body.ticket;
  });
  ipcMain.handle(IPC_CHANNELS.audio.listPhoneMicUsbDevices, () => listPhoneMicUsbDevices());
  ipcMain.handle(IPC_CHANNELS.audio.startPhoneMicUsb, (_event, serial?: string) =>
    service.start(serial),
  );
  ipcMain.handle(IPC_CHANNELS.audio.stopPhoneMicUsb, () => service.stop());
  let stoppedForQuit = false;
  app.on("before-quit", (event) => {
    if (stoppedForQuit) return;
    event.preventDefault();
    void service.stop().finally(() => {
      stoppedForQuit = true;
      app.quit();
    });
  });
};
