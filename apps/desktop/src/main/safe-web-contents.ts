import type { BrowserWindow } from "electron";

export const sendToWindow = (
  window: BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean => {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return false;
  }

  try {
    window.webContents.send(channel, ...args);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      /destroyed/i.test(error.message)
    ) {
      return false;
    }
    throw error;
  }
};
