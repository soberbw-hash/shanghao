import { app } from "electron";

export const applyLaunchOnStartup = (enabled: boolean): void => {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [],
  });
  const applied = app.getLoginItemSettings().openAtLogin;
  if (applied !== enabled) throw new Error("launch_on_startup_not_applied");
};
