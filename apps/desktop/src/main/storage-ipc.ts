import { app, ipcMain } from "electron";
import path from "node:path";
import { IPC_CHANNELS, type StorageUsage } from "@private-voice/shared";
import type { PersistentAiStoragePaths } from "./ai-storage";
import type { SettingsStore } from "./settings-store";
import { resolveRecordingDirectory } from "./recording-path";
import { asrTemporaryDirectory, pruneStaleAsrTempFiles } from "./asr-temp-files";
import { inspectStorageDirectory } from "./storage-usage";

/** Renderer chooses neither scan paths nor deletion targets. Only explicit owned temp cleanup. */
export const registerStorageIpc = (settings: SettingsStore, ai: PersistentAiStoragePaths): void => {
  let inspection: Promise<StorageUsage[]> | undefined;
  let cleanup: ReturnType<typeof pruneStaleAsrTempFiles> | undefined;
  ipcMain.handle(IPC_CHANNELS.storage.inspect, () => {
    if (inspection) return inspection;
    const categories: Array<[StorageUsage["category"], string]> = [
      ["models", ai.models],
      ["runtimes", ai.runtimes],
      [
        "recordings",
        resolveRecordingDirectory(
          settings.getSnapshot().recordingSaveDirectory,
          app.getPath("documents"),
        ),
      ],
      [
        "updates",
        path.join(
          process.env.LOCALAPPDATA || path.resolve(app.getPath("appData"), "..", "Local"),
          "shanghao-updater",
        ),
      ],
      ["temporary", asrTemporaryDirectory()],
    ];
    const pending = (async () => {
      const result: StorageUsage[] = [];
      for (const [category, directory] of categories)
        result.push(await inspectStorageDirectory(category, directory));
      return result;
    })();
    inspection = pending;
    void pending
      .finally(() => {
        if (inspection === pending) inspection = undefined;
      })
      .catch(() => undefined);
    return pending;
  });
  ipcMain.handle(IPC_CHANNELS.storage.clearExpiredTemporary, () => {
    if (cleanup) return cleanup;
    const pending = pruneStaleAsrTempFiles();
    cleanup = pending;
    void pending
      .finally(() => {
        if (cleanup === pending) cleanup = undefined;
      })
      .catch(() => undefined);
    return pending;
  });
};
