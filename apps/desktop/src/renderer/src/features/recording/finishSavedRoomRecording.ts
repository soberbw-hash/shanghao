import type { DesktopApi, RecordingMarker, VoiceMemoryProcessRequest } from "@private-voice/shared";
import type { ToastMessage } from "../../store/appStore";

interface FinishOptions {
  result: { filePath: string; recordingId?: string };
  markers: RecordingMarker[];
  roomId: string;
  roomName: string;
  speakingTimeline: VoiceMemoryProcessRequest["speakingTimeline"];
  autoTranscribe?: boolean;
  autoOrganize?: boolean;
  api: DesktopApi;
  toast: (message: Omit<ToastMessage, "id">) => void;
}
const finishing = new WeakMap<DesktopApi, Map<string, Promise<void>>>();
const completed = new WeakMap<DesktopApi, string[]>();

/** A user stop and a forced room release may both observe the same sealed file. */
export const finishSavedRoomRecording = (options: FinishOptions): Promise<void> => {
  let jobs = finishing.get(options.api);
  if (!jobs) finishing.set(options.api, (jobs = new Map()));
  const key = options.result.recordingId ?? options.result.filePath;
  const previous = jobs.get(key);
  if (previous) return previous;
  const job = finishOnce(options);
  jobs.set(key, job);
  void job.then(
    () => {
      // Keep only a small number of recently completed identities; active jobs remain owned.
      let recent = completed.get(options.api);
      if (!recent) completed.set(options.api, (recent = []));
      recent.push(key);
      while (recent.length > 32) jobs.delete(recent.shift()!);
    },
    () => {
      if (jobs.get(key) === job) jobs.delete(key);
    },
  );
  return job;
};

/** Post-processing of a sealed recording uses its originating room, never a later room selection. */
const finishOnce = async ({
  result,
  markers,
  roomId,
  roomName,
  speakingTimeline,
  autoTranscribe,
  autoOrganize,
  api,
  toast,
}: FinishOptions): Promise<void> => {
  await api.recording.saveOrigin(result.filePath, roomId, roomName);
  if (markers.length) await api.recording.saveMarkers(result.filePath, markers);
  let deletedCurrentRecording = false;
  try {
    deletedCurrentRecording = (await api.recording.applyAutomaticCleanup(result.filePath))
      .deletedCurrentRecording;
  } catch (error) {
    void api.app
      .writeLog({
        category: "app",
        level: "warn",
        message: "recording_automatic_cleanup_deferred",
        context: { error: error instanceof Error ? error.message : String(error) },
      })
      .catch(() => undefined);
  }
  if (deletedCurrentRecording) {
    toast({
      tone: "neutral",
      title: "录音已移至回收站",
      description: "自动清理按当前设置处理了这条录音，可在 Windows 回收站恢复。",
    });
    return;
  }
  if (autoTranscribe && api.ai?.processRecording) {
    void api.ai
      .processRecording({
        recordingId: result.recordingId ?? result.filePath,
        filePath: result.filePath,
        roomId,
        roomName,
        manual: false,
        organize: autoOrganize,
        markers: markers.map((marker) => ({ id: marker.id, offsetMs: marker.offsetMs })),
        speakingTimeline,
      })
      .catch((error) =>
        api.app
          .writeLog({
            category: "app",
            level: "warn",
            message: "voice_memory_auto_process_deferred",
            context: { error: error instanceof Error ? error.message : String(error) },
          })
          .catch(() => undefined),
      );
  }
  toast({ tone: "success", title: "录音已保存", description: result.filePath });
};
