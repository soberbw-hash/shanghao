import { app } from "electron";

import { configureWindowsStartupTask } from "./windows-startup-task";

export const applyLaunchOnStartup = async (enabled: boolean): Promise<void> => {
  if (!app.isPackaged) return;
  if (process.platform === "win32") {
    app.setLoginItemSettings({ openAtLogin: false });
    const status = await configureWindowsStartupTask(enabled);
    if (status.enabled !== enabled) throw new Error("launch_on_startup_not_applied");
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [],
  });
  const applied = app.getLoginItemSettings().openAtLogin;
  if (applied !== enabled) throw new Error("launch_on_startup_not_applied");
};
