import type {
  AppSettings,
  AiAsrModelId,
  RecordingLibrarySnapshot,
  VoiceMemoryProcessRequest,
  VoiceMemoryRecord,
} from "@private-voice/shared";
import {
  needsAutomaticCloudAssist,
  needsAutomaticPostprocessing,
} from "./automatic-voice-memory-request";
import { canRecoverLegacyRecording } from "./recording-memory-recovery";
import {
  canResumeRemoteTranscription,
  isDeferredRemoteTranscription,
} from "./automatic-recording-recovery";
import { isTransientRemoteTranscriptionError } from "./remote-transcription-retry";
type BacklogSettings = Pick<
  AppSettings,
  | "isAiAutoTranscribeEnabled"
  | "isAiAutoOrganizeEnabled"
  | "recordingSaveDirectory"
  | "recordingLibraryQuotaGb"
>;

export interface BacklogRecording {
  recordingId?: string;
  filePath: string;
  fileSize?: number;
  createdAt?: string;
  modifiedAt?: string;
  roomId?: string;
  roomName?: string;
  markers?: Array<{ id: string; offsetMs: number }>;
}

/** Admission only: the existing durable worker remains the sole processing queue. */
export async function queueUntranscribedRecordings(
  recordings: BacklogRecording[],
  organize: boolean,
  host: {
    enabled: () => boolean;
    get: (id: string) => Promise<VoiceMemoryRecord | undefined>;
    pending: (id: string) => boolean;
    reconcile: (recording: BacklogRecording, id: string) => Promise<unknown>;
    start: (request: VoiceMemoryProcessRequest) => Promise<unknown>;
    onError?: () => void;
    assistModel?: () => { id: AiAsrModelId; ready: boolean } | undefined;
  },
) {
  let postprocessingAdmitted = false;
  for (const item of [...recordings].sort(
    (a, b) => (a.fileSize ?? Infinity) - (b.fileSize ?? Infinity),
  )) {
    if (!host.enabled()) break;
    const id = item.recordingId ?? item.filePath;
    if (host.pending(id) || host.pending(item.filePath)) continue;
    try {
      let record =
        (await host.get(id)) ?? (id !== item.filePath ? await host.get(item.filePath) : undefined);
      if (record && (record.recordingId !== id || record.filePath !== item.filePath)) {
        if (!canRecoverLegacyRecording(record, item)) continue;
        await host.reconcile(item, id);
        record = await host.get(id);
      }
      if (
        record &&
        !canResumeRemoteTranscription(record) &&
        (isDeferredRemoteTranscription(record) ||
          isTransientRemoteTranscriptionError(record.errorMessage ?? ""))
      )
        continue;
      if (record?.transcript.length && !canResumeRemoteTranscription(record)) {
        const assist = needsAutomaticCloudAssist(record, host.assistModel?.());
        if (!postprocessingAdmitted && (assist || needsAutomaticPostprocessing(record, organize))) {
          await host.start({
            recordingId: id,
            filePath: item.filePath,
            roomId: record.roomId,
            roomName: record.roomName,
            transcribe: assist,
            organize: true,
          });
          postprocessingAdmitted = true;
        }
        continue;
      }
      if (
        record?.errorMessage === "no_reliable_speech" ||
        record?.errorMessage === "cloud_asr_unusable_transcript" ||
        (record?.phase === "paused" && !record.errorMessage?.startsWith("deferred:"))
      )
        continue;
      if (host.pending(id) || host.pending(item.filePath)) continue;
      if (!host.enabled()) break;
      await host.start({
        recordingId: id,
        filePath: item.filePath,
        roomId: record?.roomId ?? item.roomId,
        roomName: record?.roomName ?? item.roomName,
        recordedAt: record?.recordedAt ?? item.createdAt,
        transcribe: true,
        organize,
        markers: item.markers,
      });
    } catch {
      host.onError?.();
    }
  }
}

/** One asynchronous catalog scan on startup/settings changes, never on a polling timer. */
export function createAutomaticRecordingBacklog(host: {
  settings: () => BacklogSettings;
  read: (settings: BacklogSettings) => Promise<RecordingLibrarySnapshot>;
  queue: (recordings: BacklogRecording[], organize: boolean) => Promise<void>;
  onError: () => void;
}) {
  let initialized = false,
    requested = false;
  let running: Promise<void> | undefined;
  let catalogRequested = false;
  let cached: { directory?: string; library: RecordingLibrarySnapshot } | undefined;
  const refresh = (readCatalog = true) => {
    catalogRequested ||= readCatalog;
    requested = true;
    if (!initialized || running) return;
    running = Promise.resolve()
      .then(async () => {
        while (requested) {
          requested = false;
          const settings = host.settings();
          if (!settings.isAiAutoTranscribeEnabled) continue;
          const needCatalog =
            catalogRequested || !cached || cached.directory !== settings.recordingSaveDirectory;
          catalogRequested = false;
          const library = needCatalog ? await host.read(settings) : cached!.library;
          cached = { directory: settings.recordingSaveDirectory, library };
          const current = host.settings();
          if (!current.isAiAutoTranscribeEnabled) continue;
          if (current.recordingSaveDirectory !== settings.recordingSaveDirectory) {
            requested = true;
            continue;
          }
          await host.queue(library.items, true);
        }
      })
      .catch(host.onError)
      .finally(() => {
        running = undefined;
        if (requested) refresh(false);
      });
  };
  return {
    refresh: () => refresh(),
    refreshCached: () => refresh(false),
    initialize: () => {
      initialized = true;
      refresh();
    },
    settled: async () => {
      while (running) await running;
    },
  };
}
