import {
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID,
  evaluateVoiceMemoryTranscriptionValidity,
  hasInvalidVoiceMemoryResult,
  type VoiceMemoryRecord,
  type AiAsrModelId,
  type VoiceMemoryTranscriptionVariant,
} from "@private-voice/shared";
import { isVoiceMemoryOwnershipError } from "./ai-job-write-ownership";

interface CloudLocalHost {
  localModelId?: AiAsrModelId;
  isLocalReady?: (id: AiAsrModelId) => boolean;
  local: (record: VoiceMemoryRecord) => Promise<VoiceMemoryRecord>;
  save: (record: VoiceMemoryRecord) => Promise<VoiceMemoryRecord>;
  reload: () => Promise<VoiceMemoryRecord | undefined>;
  ownsRevision: (record: VoiceMemoryRecord) => boolean;
  signal: AbortSignal;
}

/** Independent transcripts stay independent. The local result supplies playback timing. */
export async function assistCloudTranscription(cloud: VoiceMemoryRecord, host: CloudLocalHost) {
  const cloudModel = cloud.transcriptionModel;
  if (cloudModel?.id !== "siliconflow-sensevoice-small" && cloudModel?.id !== "custom-asr-api")
    throw new Error("hybrid_cloud_transcript_required");
  const cloudVariant: VoiceMemoryTranscriptionVariant = {
    model: cloudModel,
    transcript: cloud.transcript,
    speakers: cloud.speakers,
    pipelineVersion: cloud.transcriptionPipelineVersion,
    transcriptionElapsedMs: cloud.transcriptionElapsedMs,
    updatedAt: cloud.updatedAt,
  };
  const resuming =
    cloud.transcriptionAssist &&
    (cloud.transcriptionAssist.status === "running" ||
      (cloud.transcriptionAssist.status === "unavailable" &&
        cloud.transcriptionVariants?.[cloud.transcriptionAssist.localModelId]));
  const localModelId =
    (resuming ? cloud.transcriptionAssist?.localModelId : undefined) ??
    host.localModelId ??
    DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID;
  if (host.isLocalReady && !host.isLocalReady(localModelId)) {
    host.signal.throwIfAborted();
    return host.save({
      ...cloud,
      phase: "ready",
      progress: 100,
      taskStatus: "success",
      errorMessage: undefined,
      transcriptionAssist: {
        status: "unavailable",
        cloudModelId: cloudModel.id,
        localModelId,
      },
    });
  }
  const previous = resuming ? cloud.transcriptionVariants?.[localModelId] : undefined;
  const queued = await host.save({
    ...cloud,
    transcriptionVariants: { ...cloud.transcriptionVariants, [cloudModel.id]: cloudVariant },
    transcriptionAssist: {
      status: "running",
      cloudModelId: cloudModel.id,
      localModelId,
    },
  });
  try {
    host.signal.throwIfAborted();
    const result = await host.local({
      ...queued,
      phase: "transcribing",
      progress: 0,
      transcript: previous?.transcript ?? [],
      speakers: previous?.speakers ?? [],
      transcriptionModel: previous?.model,
      transcriptionPipelineVersion: previous?.pipelineVersion,
      transcriptionElapsedMs: previous?.transcriptionElapsedMs,
      transcriptionStats: previous?.transcriptionStats,
      transcriptionUnits: previous?.transcriptionUnits,
      transcriptionBenchmark: undefined,
      organization: undefined,
      organizationPublication: undefined,
      organizedAt: undefined,
      summary: [],
      chapters: [],
      highlights: [],
      timeline: queued.timeline.filter((entry) => entry.kind === "marker"),
    });
    host.signal.throwIfAborted();
    if (
      result.transcriptionModel?.id !== localModelId ||
      !result.transcript.length ||
      hasInvalidVoiceMemoryResult(result) ||
      !evaluateVoiceMemoryTranscriptionValidity(
        result.transcriptionStats,
        result.transcriptionUnits,
      ).complete
    )
      throw new Error("hybrid_local_incomplete");
    return host.save({
      ...result,
      transcriptionPipelineVersion: CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
      transcriptionVariants: {
        ...result.transcriptionVariants,
        [cloudModel.id]: cloudVariant,
        [localModelId]: {
          model: result.transcriptionModel!,
          transcript: result.transcript,
          speakers: result.speakers,
          pipelineVersion: result.transcriptionPipelineVersion,
          transcriptionElapsedMs: result.transcriptionElapsedMs,
          transcriptionStats: result.transcriptionStats,
          transcriptionUnits: result.transcriptionUnits,
          updatedAt: result.updatedAt,
        },
      },
      transcriptionAssist: { ...queued.transcriptionAssist!, status: "completed" },
    });
  } catch (error) {
    // Cancellation leaves the local checkpoint and cloud variant available for a real resume.
    if (host.signal.aborted || (error as Error).message === "ai_task_paused") throw error;
    if (isVoiceMemoryOwnershipError(error)) throw error;
    const latest = await host.reload();
    host.signal.throwIfAborted();
    if (latest && !host.ownsRevision(latest))
      throw new Error("voice_memory_shared_result_changed", { cause: error });
    if (
      !latest ||
      latest.taskId !== queued.taskId ||
      latest.roomId !== queued.roomId ||
      latest.transcriptionAssist?.status !== "running"
    )
      throw new Error("voice_memory_task_superseded", { cause: error });
    const code =
      error instanceof Error && /^[a-z0-9_:-]{1,160}$/i.test(error.message)
        ? error.message
        : "hybrid_local_failed";
    return host.save({
      ...latest,
      phase: "ready",
      progress: 100,
      transcript: cloud.transcript,
      speakers: cloud.speakers,
      transcriptionModel: cloudModel,
      transcriptionPipelineVersion: cloud.transcriptionPipelineVersion,
      transcriptionElapsedMs: cloud.transcriptionElapsedMs,
      transcriptionStats: undefined,
      transcriptionUnits: undefined,
      transcriptionAssist: { ...queued.transcriptionAssist!, status: "failed", errorCode: code },
      errorMessage: undefined,
    });
  }
}
