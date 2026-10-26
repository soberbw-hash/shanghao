import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
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
    "launch-dev.ps1",
  );

const developmentLaunch = () =>
  existsSync(launcherPath())
    ? {
        target: path.join(
          process.env.SystemRoot ?? "C:/Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        args: `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${elevatedDevelopmentCommand()}`,
      }
    : { target: process.execPath, args: `"${app.getAppPath()}"` };

const elevatedDevelopmentCommand = (): string => {
  const encodedPath = Buffer.from(launcherPath(), "utf16le").toString("base64");
  const body = `$taskFile = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedPath}')); & ([ScriptBlock]::Create([IO.File]::ReadAllText($taskFile)))`;
  const encoded = Buffer.from(body, "utf16le").toString("base64");
  const script = [
    "$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()",
    "$taskPrincipal = New-Object Security.Principal.WindowsPrincipal($taskIdentity)",
    "if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {",
    "$taskShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'",
    `Start-Process -FilePath $taskShell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encoded}'`,
    "exit",
    "}",
    body,
  ].join("\n");
  return Buffer.from(script, "utf16le").toString("base64");
};

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
    path.join(app.getPath("desktop"), `${APP_NAME}开发版.lnk`),
    path.join(programs, `${APP_NAME}开发版.lnk`),
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
  // Shell shortcuts outlive development build directories. Keep their icon in
  // the same persistent location as the launcher, rather than in build output.
  const sourceIcon = path.join(app.getAppPath(), "build", "shanghao-icon-v4.ico");
  const iconBytes = readFileSync(sourceIcon);
  const iconHash = createHash("sha256").update(iconBytes).digest("hex").slice(0, 12);
  const icon = path.join(path.dirname(launcherPath()), `shanghao-dev-${iconHash}.ico`);
  mkdirSync(path.dirname(icon), { recursive: true });
  if (!existsSync(icon) || !readFileSync(icon).equals(iconBytes)) {
    const pendingIcon = `${icon}.${process.pid}.tmp`;
    writeFileSync(pendingIcon, iconBytes);
    renameSync(pendingIcon, icon);
  }
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
  // Retire the displayed old Shell item only after the replacement is written.
  for (const folder of [app.getPath("desktop"), programs]) {
    const previous = path.join(folder, `${APP_NAME}（开发版）.lnk`);
    if (!existsSync(previous)) continue;
    const current = shell.readShortcutLink(previous);
    if (
      current.appUserModelId !== `${APP_ID}.dev` ||
      !/wscript\.exe$/i.test(current.target) ||
      !/ShangHaoDev[\\/]?launch-dev\.vbs/i.test(current.args ?? "")
    )
      continue;
    const backup = path.join(path.dirname(launcherPath()), "shortcut-backups", String(Date.now()));
    mkdirSync(backup, { recursive: true });
    copyFileSync(
      previous,
      path.join(backup, folder === programs ? "start-menu.lnk" : "desktop.lnk"),
    );
    unlinkSync(previous);
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
