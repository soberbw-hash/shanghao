import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  type AppSettings,
  type RecordingAutomaticCleanupResult,
  type RecordingBatchDeleteResult,
} from "@private-voice/shared";
import type { AiVoiceMemoryService } from "./ai-voice-memory-service";
import { getUsableRecordingDirectory } from "./recording-library";
import { readRecordingLibraryFromDirectory } from "./recording-library-core";
import { RecordingRecycleBin } from "./recording-recycle-bin";
import { cleanupRecordingParticipantTracks } from "./recording-participant-tracks";
import { cleanupRecordingSpeakerSegments } from "./recording-speaker-segments";
import { inspectRecordingForCleanup } from "./recording-cleanup";
import {
  selectRecordingMaintenanceBatch,
  shouldRecycleRecording,
} from "./recording-recycle-maintenance";

export function registerRecordingRecycleIpc(
  getSettings: () => AppSettings,
  getWindow: () => BrowserWindow | null,
  memory: AiVoiceMemoryService,
  log: (error: unknown) => void,
  clearCheckpoints: (id: string) => Promise<void>,
): {
  recycleScanned: (
    filePath: string,
    recordingId: string,
    fileSize: number,
    modifiedAt: string,
  ) => Promise<void>;
} {
  const bins = new Map<string, RecordingRecycleBin>();
  const current = async () => {
    const settings = getSettings();
    const directory = await getUsableRecordingDirectory(settings.recordingSaveDirectory);
    let bin = bins.get(directory);
    if (!bin) {
      const ids = (item: { recordingId: string; filePath: string }) => [
        ...new Set([item.recordingId, item.filePath]),
      ];
      bin = new RecordingRecycleBin(directory, {
        suspend: async (item, token) => {
          for (const id of ids(item)) await memory.setRecycled(id, token, true);
        },
        resume: async (item, token) => {
          for (const id of ids(item)) await memory.setRecycled(id, token, false);
        },
        purge: async (item, token) => {
          for (const id of ids(item)) {
            await memory.setRecycled(id, token, true);
            await memory.delete(id);
            await clearCheckpoints(id); // Unlike manual deletion, expiry remains retryable until every artifact is gone.
          }
          await cleanupRecordingParticipantTracks(item.recordingId);
          await cleanupRecordingSpeakerSegments(item.recordingId);
        },
      });
      bins.set(directory, bin);
    }
    return { settings, directory, bin };
  };
  const check = (event: IpcMainInvokeEvent) => {
    const contents = getWindow()?.webContents;
    if (
      !contents ||
      contents.isDestroyed() ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    )
      throw Error("recording_recycle_forbidden");
  };
  const bind = (channel: string, handler: (...args: never[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      check(event);
      return handler(...(args as never[]));
    });
  const requirePath = (value: unknown): string => {
    if (typeof value !== "string" || value.length > 2048 || !value.trim())
      throw Error("invalid_recording_file_path");
    return value;
  };
  const recycle = async (filePath: string, protect = false) => {
    const { directory, settings, bin } = await current();
    const snapshot = await readRecordingLibraryFromDirectory(
      directory,
      settings.recordingLibraryQuotaGb,
    );
    const item = snapshot.items.find((entry) => entry.filePath === filePath);
    if (!item) throw Error("recording_not_found");
    await bin.recycle(item, protect);
  };
  bind(IPC_CHANNELS.recording.delete, (filePath: string) => recycle(requirePath(filePath)));
  bind(
    IPC_CHANNELS.recording.deleteMany,
    async (values: unknown): Promise<RecordingBatchDeleteResult> => {
      if (!Array.isArray(values) || values.length > 500)
        throw Error("invalid_recording_delete_batch");
      const paths = [...new Set(values.map(requirePath))];
      const result: RecordingBatchDeleteResult = { deletedFilePaths: [], failed: [] };
      for (const filePath of paths) {
        try {
          await recycle(filePath);
          result.deletedFilePaths.push(filePath);
        } catch {
          result.failed.push({ filePath, message: "未能移入回收站，原文件或恢复日志已保留。" });
        }
      }
      return result;
    },
  );
  bind(IPC_CHANNELS.recordingRecycle.list, async () => {
    const { bin } = await current();
    await bin.purgeExpired();
    return (await bin.list())
      .filter((entry) => entry.phase === "ready")
      .map(({ id, item, deletedAt, expiresAt }) => ({
        id,
        title: item.title,
        fileSize: item.fileSize,
        deletedAt,
        expiresAt,
      }));
  });
  bind(IPC_CHANNELS.recordingRecycle.restore, async (id: string) => {
    await (await current()).bin.restore(id);
  });
  let maintenance: Promise<RecordingAutomaticCleanupResult> | undefined;
  const cursors = new Map<string, number>();
  const maintain = (newestFilePath?: string): Promise<RecordingAutomaticCleanupResult> => {
    if (maintenance) return maintenance;
    maintenance = (async () => {
      const { settings, directory, bin } = await current();
      await bin.purgeExpired();
      const result: RecordingAutomaticCleanupResult = {
        deletedFilePaths: [],
        deletedCurrentRecording: false,
        wasteDeletedCount: 0,
        quotaDeletedCount: 0,
      };
      if (!settings.isRecordingWasteAutoCleanupEnabled) return result;
      const snapshot = await readRecordingLibraryFromDirectory(
        directory,
        settings.recordingLibraryQuotaGb,
      );
      const batch = selectRecordingMaintenanceBatch(
        snapshot.items,
        cursors.get(directory) ?? 0,
        newestFilePath,
      );
      cursors.set(directory, batch.cursor);
      for (const item of batch.items) {
        const probe = await inspectRecordingForCleanup(item.filePath).catch(() => undefined);
        const latest = getSettings();
        if (
          !latest.isRecordingWasteAutoCleanupEnabled ||
          latest.recordingSaveDirectory !== settings.recordingSaveDirectory
        )
          break;
        if (
          probe?.filePath !== item.filePath ||
          !shouldRecycleRecording(probe, latest.isRecordingShortAutoCleanupEnabled !== false)
        )
          continue;
        try {
          await bin.recycle(item, true);
        } catch (error) {
          log(error);
          continue;
        }
        result.deletedFilePaths.push(item.filePath);
        result.wasteDeletedCount++;
      }
      result.deletedCurrentRecording = result.deletedFilePaths.includes(newestFilePath ?? "");
      return result;
    })().finally(() => {
      maintenance = undefined;
    });
    return maintenance;
  };
  bind(IPC_CHANNELS.recording.applyAutomaticCleanup, (filePath: string) =>
    maintain(requirePath(filePath)),
  );
  const startup = setTimeout(() => {
    void maintain().catch(log);
  }, 60_000);
  const timer = setInterval(() => {
    void maintain().catch(log);
  }, 15 * 60_000);
  startup.unref();
  timer.unref();
  app.once("will-quit", () => {
    clearTimeout(startup);
    clearInterval(timer);
  });
  return {
    recycleScanned: async (filePath, recordingId, fileSize, modifiedAt) => {
      const { directory, settings, bin } = await current();
      const item = (
        await readRecordingLibraryFromDirectory(directory, settings.recordingLibraryQuotaGb)
      ).items.find(
        (entry) =>
          entry.filePath === filePath &&
          entry.recordingId === recordingId &&
          entry.fileSize === fileSize &&
          entry.modifiedAt === modifiedAt,
      );
      if (!item) throw Error("recording_changed_since_scan");
      await bin.recycle(item, true);
    },
  };
}
