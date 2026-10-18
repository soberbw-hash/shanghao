import { copyFileSync, existsSync, mkdirSync, realpathSync, watch } from "node:fs";
import path from "node:path";
import { app, shell } from "electron";
import { APP_ID, APP_NAME } from "@private-voice/shared";
import { platformService } from "./platform/PlatformService";

export const windowsAppUserModelId = (): string =>
  app.isPackaged
    ? APP_ID
    : process.env.SHANGHAO_CAPTURE_PATH
      ? `${APP_ID}.capture`
      : `${APP_ID}.dev`;

const launcherPath = () =>
  path.join(
    process.env.LOCALAPPDATA ?? app.getPath("appData"),
    "Programs",
    "ShangHaoDev",
    "launch-dev.vbs",
  );

const developmentLaunch = () =>
  existsSync(launcherPath())
    ? {
        target: path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "wscript.exe"),
        args: `"${launcherPath()}"`,
      }
    : { target: process.execPath, args: `"${app.getAppPath()}"` };

export const developmentRelaunchCommand = (): string => {
  const { target, args } = developmentLaunch();
  return `"${target}" ${args}`;
};

/** Keep the compatibility link branded too: removing it lets Electron recreate it. */
export const repairDevelopmentShortcuts = (): void => {
  if (!platformService.isWindows || app.isPackaged || process.env.SHANGHAO_CAPTURE_PATH) return;
  const programs = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
  const electronLink = path.join(programs, "Electron.lnk");
  const targets = [
    path.join(app.getPath("desktop"), `${APP_NAME}（开发版）.lnk`),
    path.join(programs, `${APP_NAME}（开发版）.lnk`),
  ];
  if (existsSync(electronLink)) {
    const link = shell.readShortcutLink(electronLink);
    if (
      link.appUserModelId === `${APP_ID}.dev` &&
      !link.args &&
      realpathSync(link.target).toLowerCase() === realpathSync(process.execPath).toLowerCase()
    ) {
      const backup = path.join(
        process.env.LOCALAPPDATA ?? app.getPath("appData"),
        "ShangHao-brand-backups",
        "dev-shortcuts",
        String(Date.now()),
      );
      mkdirSync(backup, { recursive: true });
      copyFileSync(electronLink, path.join(backup, "Electron.lnk"));
      targets.push(electronLink);
    }
  }
  const launch = developmentLaunch();
  const icon = path.join(app.getAppPath(), "build", "shanghao-icon-v4.ico");
  for (const shortcut of targets) {
    mkdirSync(path.dirname(shortcut), { recursive: true });
    if (existsSync(shortcut)) {
      const current = shell.readShortcutLink(shortcut);
      if (
        current.target === launch.target &&
        current.args === launch.args &&
        current.icon === icon &&
        current.appUserModelId === `${APP_ID}.dev`
      )
        continue;
    }
    if (
      !shell.writeShortcutLink(shortcut, "create", {
        ...launch,
        cwd: app.getAppPath(),
        icon,
        iconIndex: 0,
        appUserModelId: `${APP_ID}.dev`,
        description: "启动上号开发版并自动准备本地开发服务",
      })
    )
      throw new Error("development_shortcut_write_failed");
  }
};

export const watchDevelopmentShortcuts = (): (() => void) => {
  if (!platformService.isWindows || app.isPackaged || process.env.SHANGHAO_CAPTURE_PATH)
    return () => undefined;
  const programs = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
  let pending: NodeJS.Timeout | undefined;
  const watcher = watch(programs, (_event, file) => {
    if (String(file).toLowerCase() !== "electron.lnk") return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      try {
        repairDevelopmentShortcuts();
      } catch {
        /* Retry on the next shortcut change. */
      }
    }, 150);
  });
  watcher.on("error", () => undefined);
  return () => {
    if (pending) clearTimeout(pending);
    watcher.close();
  };
};
