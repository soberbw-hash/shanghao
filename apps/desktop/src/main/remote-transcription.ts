import { randomUUID } from "node:crypto";
import {
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
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
  const result = await host.store.transcribe(record.filePath, audio.durationMs, provider, signal);
  signal.throwIfAborted();
  const segments = parseVibeVoiceOutput(result.text, record.recordingId, 0, audio.durationMs);
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
      name: result.modelName,
    },
    transcriptionElapsedMs: performance.now() - started,
    speakers: [{ speakerId: "Speaker 1", confidence: "pending" }],
    transcript: segments,
    errorMessage: undefined,
  });
}
