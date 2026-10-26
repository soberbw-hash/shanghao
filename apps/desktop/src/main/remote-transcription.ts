import { randomUUID } from "node:crypto";
import {
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  hasInvalidVoiceMemoryResult,
  evaluateVoiceMemoryTranscriptionValidity,
  type AiTranscriptionProvider,
  type AiAsrModelId,
  type VoiceMemoryRecord,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryProcessingStage,
  type VoiceMemoryTaskDiagnostic,
  type VoiceMemoryTaskStatus,
} from "@private-voice/shared";
import type { AiTranscriptionProviderStore } from "./ai-transcription-provider-store";
import { probeRecordingMedia } from "./recording-media-probe";
import { parseVibeVoiceOutput } from "./asr-transcript-parser";
import { remoteTranscriptionRanges } from "./remote-transcription-parts";
import {
  loadRemoteTranscriptionSources,
  transcribeRemoteSources,
} from "./remote-transcription-sources";
import { bindTranscriptToKnownSpeaker } from "./speaker-transcript";
import { transcribeRemoteWithRetry } from "./remote-transcription-retry";
import { assistCloudTranscription } from "./cloud-local-transcription";
import { transcribeRemoteWithEmptyRecovery } from "./remote-transcription-empty";
import { transcribeCloudSpeechWindows } from "./remote-speech-windows";

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
    return (
      !record.remoteTranscription ||
      (
        record.remoteTranscription.sources?.flatMap((source) =>
          remoteTranscriptionRanges(source.durationMs, record.remoteTranscription?.partMs).map(
            (range) => ({
              ...range,
              startMs: source.startMs + range.startMs,
              sourceId: source.id,
            }),
          ),
        ) ??
        remoteTranscriptionRanges(
          record.remoteTranscription.audioDurationMs,
          record.remoteTranscription.partMs,
        ).map((range) => ({
          ...range,
          sourceId: undefined,
        }))
      ).every((range) =>
        record.remoteTranscription!.parts.some(
          (part) =>
            part.startMs === range.startMs &&
            part.durationMs === range.durationMs &&
            part.sourceId === range.sourceId,
        ),
      )
    );
  return evaluateVoiceMemoryTranscriptionValidity(
    record.transcriptionStats,
    record.transcriptionUnits,
  ).complete;
};

interface RemoteTranscriptionHost {
  manual?: boolean;
  record: VoiceMemoryRecord;
  provider: Exclude<AiTranscriptionProvider, "local">;
  signal: AbortSignal;
  onStage?: (stage: VoiceMemoryProcessingStage) => void;
  store?: AiTranscriptionProviderStore;
  assist?: (record: VoiceMemoryRecord) => Promise<VoiceMemoryRecord>;
  assistModelId?: AiAsrModelId;
  isAssistModelReady?: (id: AiAsrModelId) => boolean;
  reload?: () => Promise<VoiceMemoryRecord | undefined>;
  ownsRevision?: (record: VoiceMemoryRecord) => boolean;
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
  manual = true,
  onStage,
  ...host
}: RemoteTranscriptionHost): Promise<VoiceMemoryRecord> {
  if (!host.store) throw new Error("remote_asr_unavailable");
  const status = await host.store.status();
  if (provider === "cloud" && !status.cloudConfigured)
    throw new Error(status.cloudErrorCode ?? "cloud_asr_not_configured");
  if (!manual) {
    if (!(provider === "cloud" ? status.cloudConfigured : status.customConfigured))
      throw new Error(
        provider === "cloud" ? "cloud_asr_not_configured" : "custom_asr_key_required",
      );
  }
  const taskId =
    record.taskId ?? `voice-memory:${record.recordingId}:${Date.now()}-${randomUUID().slice(0, 8)}`;
  const request = { recordingId: record.recordingId, filePath: record.filePath };
  const modelId = provider === "cloud" ? "siliconflow-sensevoice-small" : "custom-asr-api";
  const savedCloud = record.transcriptionVariants?.[modelId];
  const reusableCloud =
    record.transcriptionModel?.id === modelId
      ? record
      : record.transcriptionAssist?.status === "running" && savedCloud
        ? {
            ...record,
            transcript: savedCloud.transcript,
            speakers: savedCloud.speakers,
            transcriptionModel: savedCloud.model,
            transcriptionPipelineVersion: savedCloud.pipelineVersion,
            transcriptionElapsedMs: savedCloud.transcriptionElapsedMs,
            transcriptionStats: undefined,
            transcriptionUnits: undefined,
            errorMessage: undefined,
          }
        : undefined;
  if (
    host.assist &&
    host.reload &&
    host.ownsRevision &&
    reusableCloud &&
    (provider === "cloud" ||
      (reusableCloud.transcriptionModel?.name === status.customModel &&
        reusableCloud.remoteTranscription?.baseUrl === status.customBaseUrl)) &&
    !hasInvalidVoiceMemoryResult(reusableCloud) &&
    isTranscriptionExecutionComplete(reusableCloud)
  )
    return assistCloudTranscription(reusableCloud, {
      localModelId: host.assistModelId,
      isLocalReady: host.isAssistModelReady,
      local: host.assist,
      save: host.save,
      reload: host.reload,
      ownsRevision: host.ownsRevision,
      signal,
    });
  const continuing =
    record.transcriptionModel?.id === modelId &&
    (provider === "cloud" ||
      (record.transcriptionModel.name === status.customModel &&
        record.remoteTranscription?.baseUrl === status.customBaseUrl));
  record = await host.save({
    ...record,
    phase: "transcribing",
    progress: continuing ? record.progress : 0,
    transcriptionElapsedMs: undefined,
  });
  const audio = await probeRecordingMedia(record.filePath, { signal });
  const sources = await loadRemoteTranscriptionSources(record, audio.durationMs, signal);
  const sourceMetadata = sources?.map(({ filePath: _filePath, ...metadata }) => metadata);
  const savedRemote = record.remoteTranscription;
  const partMs = provider === "cloud" ? 30000 : 300000;
  const remote = {
    partMs,
    modelId,
    modelName: provider === "custom" ? status.customModel : undefined,
    baseUrl: provider === "custom" ? status.customBaseUrl : undefined,
    audioDurationMs: audio.durationMs,
    sources: sourceMetadata,
    parts:
      savedRemote?.modelId === modelId &&
      (savedRemote.partMs ?? 300000) === partMs &&
      savedRemote.audioDurationMs === audio.durationMs &&
      JSON.stringify(savedRemote.sources) === JSON.stringify(sourceMetadata) &&
      (provider === "cloud" ||
        (savedRemote.modelName === status.customModel &&
          savedRemote.baseUrl === status.customBaseUrl))
        ? [...savedRemote.parts]
        : [],
  } satisfies NonNullable<VoiceMemoryRecord["remoteTranscription"]>;
  const upgraded = provider === "cloud" && savedRemote?.partMs !== partMs;
  record = await host.save({
    ...record,
    remoteTranscription: remote,
    ...(upgraded ? { remoteTranscriptionRetry: undefined } : {}),
    ...(upgraded &&
    record.transcript.length &&
    record.transcriptionModel &&
    !record.transcriptionVariants?.[modelId]
      ? {
          transcriptionVariants: {
            ...record.transcriptionVariants,
            [modelId]: {
              model: record.transcriptionModel,
              transcript: record.transcript,
              speakers: record.speakers,
              updatedAt: record.updatedAt,
            },
          },
        }
      : {}),
  });
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
  const sameSources = JSON.stringify(savedRemote?.sources) === JSON.stringify(sourceMetadata);
  let segments: ReturnType<typeof parseVibeVoiceOutput> =
    continuing && sameSources ? [...record.transcript] : [];
  const speakers = sources
    ? [
        ...new Map(
          sources.map((source) => [
            source.speakerId,
            {
              speakerId: source.speakerId,
              memberId: source.speakerId,
              nickname: source.displayNameSnapshot,
              displayNameSnapshot: source.displayNameSnapshot,
              confidence: "high" as const,
            },
          ]),
        ).values(),
      ]
    : [{ speakerId: "Speaker 1", confidence: "pending" as const }];
  const parts = await transcribeRemoteSources(
    record.filePath,
    audio.durationMs,
    sources,
    signal,
    (file, duration) =>
      provider === "cloud"
        ? transcribeCloudSpeechWindows(file, signal, (part, length) =>
            transcribeRemoteWithRetry(
              () => store.transcribe(part, length, provider, signal),
              signal,
            ),
          )
        : transcribeRemoteWithEmptyRecovery(
            file,
            duration,
            signal,
            (part, length) =>
              transcribeRemoteWithRetry(
                () => store.transcribe(part, length, provider, signal),
                signal,
              ),
            async (index, count) => {
              record = await host.updateDiagnostic(record, request, taskId, "asr", "processing", {
                runtimeMessage: `云端返回空文字，正在按 30 秒复核 ${index}/${count} 段`,
              });
            },
          ),
    async (index, count) => {
      record = await host.updateDiagnostic(record, request, taskId, "asr", "processing", {
        runtimeMessage: `正在转录第 ${index}/${count} 段，完成后自动合并`,
      });
    },
    async (part, index, count) => {
      const source = sources?.find((candidate) => candidate.id === part.sourceId);
      const parsed = parseVibeVoiceOutput(
        part.text,
        record.recordingId,
        source ? 0 : part.startMs,
        part.durationMs,
      );
      const replacement = source
        ? bindTranscriptToKnownSpeaker(
            record.recordingId,
            index,
            {
              speakerId: source.speakerId,
              displayNameSnapshot: source.displayNameSnapshot,
              startMs: part.startMs,
              endMs: part.startMs + part.durationMs,
            },
            parsed,
          ).map((segment) => ({ ...segment, sourceChunkId: part.sourceId }))
        : parsed;
      if (replacement.length || !part.text.trim())
        segments = [
          ...segments.filter(
            (segment) =>
              segment.sourceChunkId !== part.sourceId ||
              segment.startMs < part.startMs ||
              segment.startMs >= part.startMs + part.durationMs,
          ),
          ...replacement,
        ].sort((left, right) => left.startMs - right.startMs);
      remote.parts = [
        ...remote.parts.filter(
          (saved) => saved.startMs !== part.startMs || saved.sourceId !== part.sourceId,
        ),
        part,
      ].sort((left, right) => left.startMs - right.startMs);
      record = await host.save({
        ...record,
        progress: Math.min(99, Math.floor((remote.parts.length / count) * 100)),
        transcript: [...segments],
        remoteTranscription: { ...remote, parts: [...remote.parts] },
        speakers,
        transcriptionModel: {
          id: provider === "cloud" ? "siliconflow-sensevoice-small" : "custom-asr-api",
          name: part.modelName,
        },
        transcriptionStats: undefined,
        transcriptionUnits: undefined,
        diagnostic: record.diagnostic
          ? {
              ...record.diagnostic,
              runtimeMessage: `已完成 ${remote.parts.length}/${count} 段，文字已保存在本机`,
            }
          : undefined,
      });
    },
    (start, duration, sourceId) =>
      remote.parts.find(
        (part) =>
          part.startMs === start &&
          part.durationMs === duration &&
          part.sourceId === sourceId &&
          (part.text.trim() || part.emptyRechecked),
      ),
    { partMs, forcePcm: provider === "cloud" },
  );
  signal.throwIfAborted();
  if (!segments.length) throw new Error("cloud_asr_unusable_transcript");
  const completed = await host.save({
    ...record,
    remoteTranscriptionRetry: undefined,
    phase: host.assist ? "transcribing" : "ready",
    progress: host.assist ? 70 : 100,
    taskStatus: host.assist ? "processing" : "success",
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
    speakers,
    transcript: segments,
    errorMessage: undefined,
  });
  return host.assist && host.reload && host.ownsRevision
    ? assistCloudTranscription(completed, {
        localModelId: host.assistModelId,
        isLocalReady: host.isAssistModelReady,
        local: host.assist,
        save: host.save,
        reload: host.reload,
        ownsRevision: host.ownsRevision,
        signal,
      })
    : completed;
}
