import { randomUUID } from "node:crypto";
import {
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  evaluateVoiceMemoryTranscriptionValidity,
  type AiTranscriptionProvider,
  type VoiceMemoryRecord,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryProcessingStage,
  type VoiceMemoryTaskDiagnostic,
  type VoiceMemoryTaskStatus,
} from "@private-voice/shared";
import type { AiTranscriptionProviderStore } from "./ai-transcription-provider-store";
import { probeRecordingMedia } from "./recording-media-probe";
import { parseVibeVoiceOutput } from "./asr-transcript-parser";
import { transcribeRemoteParts } from "./remote-transcription-parts";

/** Whole-file API output has no local chunk/VAD statistics. Organization has its own status. */
export const isTranscriptionExecutionComplete = (record: VoiceMemoryRecord): boolean => {
  if (
    (record.transcriptionModel?.id === "siliconflow-sensevoice-small" ||
      record.transcriptionModel?.id === "custom-asr-api") &&
    Number.isFinite(record.transcriptionElapsedMs) &&
    (record.transcriptionElapsedMs ?? -1) >= 0 &&
    record.transcriptionStats === undefined &&
    record.transcriptionUnits === undefined &&
    record.transcript.some((segment) => segment.text.trim())
  )
    return true;
  return evaluateVoiceMemoryTranscriptionValidity(
    record.transcriptionStats,
    record.transcriptionUnits,
  ).complete;
};

interface RemoteTranscriptionHost {
  record: VoiceMemoryRecord;
  provider: Exclude<AiTranscriptionProvider, "local">;
  signal: AbortSignal;
  onStage?: (stage: VoiceMemoryProcessingStage) => void;
  store?: AiTranscriptionProviderStore;
  updateDiagnostic: (
    record: VoiceMemoryRecord,
    request: Pick<VoiceMemoryProcessRequest, "recordingId" | "filePath" | "taskId">,
    taskId: string,
    stage: VoiceMemoryProcessingStage,
    status: VoiceMemoryTaskStatus,
    patch?: Partial<VoiceMemoryTaskDiagnostic>,
  ) => Promise<VoiceMemoryRecord>;
  save: (record: VoiceMemoryRecord) => Promise<VoiceMemoryRecord>;
}

/** Cloud transcription owns no local runtime or compute lease. */
export async function transcribeWithRemoteProvider({
  record,
  provider,
  signal,
  onStage,
  ...host
}: RemoteTranscriptionHost): Promise<VoiceMemoryRecord> {
  if (!host.store) throw new Error("remote_asr_unavailable");
  const taskId =
    record.taskId ?? `voice-memory:${record.recordingId}:${Date.now()}-${randomUUID().slice(0, 8)}`;
  const request = { recordingId: record.recordingId, filePath: record.filePath };
  const audio = await probeRecordingMedia(record.filePath, { signal });
  record = await host.updateDiagnostic(record, request, taskId, "preprocess", "processing", {
    inputFormat: audio.inputFormat,
    modelName: provider === "cloud" ? "SenseVoiceSmall" : "自定义转录 API",
  });
  onStage?.("asr");
  record = await host.updateDiagnostic(record, request, taskId, "asr", "processing", {
    runtimeMessage: "正在上传音频并请求云端转录",
  });
  const started = performance.now();
  const store = host.store;
  const parts = await transcribeRemoteParts(
    record.filePath,
    audio.durationMs,
    signal,
    (file, duration) => store.transcribe(file, duration, provider, signal),
    async (index, count) => {
      record = await host.updateDiagnostic(record, request, taskId, "asr", "processing", {
        runtimeMessage: `正在转录第 ${index}/${count} 段，完成后自动合并`,
      });
    },
  );
  signal.throwIfAborted();
  const segments = parts.flatMap((part) =>
    parseVibeVoiceOutput(part.text, record.recordingId, part.startMs, part.durationMs),
  );
  if (!segments.length) throw new Error("cloud_asr_unusable_transcript");
  return host.save({
    ...record,
    phase: "ready",
    progress: 100,
    taskStatus: "success",
    processingStage: "transcript",
    transcriptionPipelineVersion: CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
    transcriptionModel: {
      id: provider === "cloud" ? "siliconflow-sensevoice-small" : "custom-asr-api",
      name: parts[0]!.modelName,
    },
    transcriptionElapsedMs: performance.now() - started,
    transcriptionStats: undefined,
    transcriptionUnits: undefined,
    transcriptionBenchmark: undefined,
    speakers: [{ speakerId: "Speaker 1", confidence: "pending" }],
    transcript: segments,
    errorMessage: undefined,
  });
}
