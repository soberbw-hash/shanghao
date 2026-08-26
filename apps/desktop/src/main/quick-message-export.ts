import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

import { app, dialog, shell, type BrowserWindow, type OpenDialogOptions } from "electron";

import { resolveQuickMessagePackDirectory } from "./quick-message-assets";

export const exportQuickMessagePack = async (
  parentWindow?: BrowserWindow | null,
): Promise<string | undefined> => {
  const options: OpenDialogOptions = {
    title: "选择语音包导出位置",
    buttonLabel: "导出到这里",
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return undefined;

  const sourceDirectory = await resolveQuickMessagePackDirectory();
  const destinationDirectory = path.join(result.filePaths[0], "上号语音包");
  await mkdir(destinationDirectory, { recursive: true });
  await cp(sourceDirectory, destinationDirectory, { recursive: true, force: true });
  await shell.openPath(destinationDirectory);
  return destinationDirectory;
};
