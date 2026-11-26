import { app, nativeImage, Notification } from "electron";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { platformService } from "./platform/PlatformService";
import {
  systemNotificationDelivery,
  type NotificationDelivery,
  type NotificationFailureReason,
} from "./notification-delivery";
import { windowsToastXml, type WindowsToastContent } from "./windows-toast";

interface DesktopNotice {
  title: string;
  body: string;
  silent?: boolean;
  actions?: readonly { label: string; run: () => void }[];
  artwork?: "transcription" | "voice-replay";
  imageDataUrl?: string;
}

function decodeThumbnail(value: string | undefined) {
  if (
    !value ||
    value.length > 180_000 ||
    !/^data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(value)
  )
    return;
  const image = nativeImage.createFromDataURL(value);
  if (image.isEmpty()) return;
  const { width, height } = image.getSize();
  const scale = Math.min(1, 320 / width, 168 / height);
  return scale === 1 ? image : image.resize({ width: Math.max(1, Math.round(width * scale)) });
}

function stageThumbnail(image: Electron.NativeImage) {
  let dir: string | undefined;
  let file: string | undefined;
  const cleanup = () => {
    try {
      if (file) unlinkSync(file);
    } catch {
      /* Already removed or temporarily held by Windows. */
    }
    try {
      if (dir) rmdirSync(dir);
    } catch {
      /* Do not remove other files. */
    }
  };
  try {
    dir = mkdtempSync(path.join(app.getPath("temp"), "shanghao-notice-"));
    file = path.join(dir, "preview.png");
    writeFileSync(file, image.toPNG(), { flag: "wx", mode: 0o600 });
    return { url: pathToFileURL(file).href, cleanup };
  } catch {
    cleanup();
  }
}

export function canShowDesktopNotification(): boolean {
  return Notification.isSupported();
}

export function showDesktopNotification(
  notice: DesktopNotice,
  onClick: () => void,
  onFailure: (reason: NotificationFailureReason) => void,
  delivery: NotificationDelivery = systemNotificationDelivery,
): void {
  if (!canShowDesktopNotification()) return;
  const actions = notice.actions ?? [];
  const title = notice.title.replace(/\s+/gu, " ").trim();
  const body = notice.body.replace(/\s+/gu, " ").trim();
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "build", "icon.png")
    : path.join(app.getAppPath(), "build", "icon.png");
  let cleanup: (() => void) | undefined;
  try {
    const thumbnail = decodeThumbnail(notice.imageDataUrl);
    const native = new Notification({
      title,
      body,
      silent: notice.silent,
      icon: thumbnail ?? iconPath,
      actions: actions.map(({ label }) => ({ type: "button", text: label })),
    });
    if (platformService.isWindows) {
      let image: WindowsToastContent["image"];
      if (notice.artwork) {
        const folder = app.isPackaged
          ? path.join(process.resourcesPath, "notices")
          : path.join(app.getAppPath(), "src/renderer/src/assets/notices");
        image = {
          url: pathToFileURL(path.join(folder, notice.artwork + ".jpg")).href,
          placement: "hero",
        };
      } else if (thumbnail) {
        const staged = stageThumbnail(thumbnail);
        cleanup = staged?.cleanup;
        if (staged) image = { url: staged.url, placement: "inline", alt: "收到的图片" };
      }
      native.toastXml = windowsToastXml(
        {
          title,
          body,
          silent: notice.silent,
          actions: actions.map(({ label }) => label),
          logoUrl: pathToFileURL(iconPath).href,
          image,
        },
        native.id,
      );
    }
    delivery.show(native, onClick, onFailure, (index) => actions[index]?.run(), cleanup);
  } catch {
    cleanup?.();
    onFailure("failed");
  }
}
