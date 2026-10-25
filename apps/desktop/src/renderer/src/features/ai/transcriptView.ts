import type {
  VoiceMemoryRecord,
  VoiceMemoryTranscriptionModel,
  VoiceMemoryTranscriptSegment,
  VoiceMemorySpeaker,
} from "@private-voice/shared";
export type TranscriptViewChoice = "auto" | "fusion" | "cloud" | "local" | "unknown";
export interface TranscriptView {
  kind: "fusion" | "cloud" | "local" | "unknown";
  label: string;
  model?: VoiceMemoryTranscriptionModel;
  transcript: VoiceMemoryTranscriptSegment[];
  speakers: VoiceMemorySpeaker[];
  estimated: boolean;
  reviewedCount?: number;
  textUnchanged?: boolean;
  timingLabel?: string;
  memberCoverage?: string;
}
const isCloud = (id: string) => id === "siliconflow-sensevoice-small" || id === "custom-asr-api";
export function transcriptViewOptions(record?: VoiceMemoryRecord): TranscriptView[] {
  if (!record) return [];
  const result = new Map<TranscriptView["kind"], TranscriptView>();
  const add = (
    model: VoiceMemoryTranscriptionModel | undefined,
    transcript: VoiceMemoryTranscriptSegment[],
    speakers: VoiceMemorySpeaker[],
  ) => {
    if (!model || !transcript.length) return;
    const kind = isCloud(model.id) ? "cloud" : "local";
    const members = new Set(
      kind === "cloud"
        ? record.remoteTranscription?.sources?.map((source) => source.speakerId)
        : [],
    );
    const recognized = new Set(
      transcript.map((row) => row.memberId ?? row.speakerId).filter((id) => id && members.has(id)),
    ).size;
    result.set(kind, {
      kind,
      label: kind === "cloud" ? "云端原稿" : "本地原稿",
      model,
      transcript,
      speakers,
      estimated: kind === "cloud",
      ...(kind === "cloud" && record.remoteTranscription?.partMs === 30000
        ? { timingLabel: "语音段定位" }
        : {}),
      ...(members.size > 1
        ? {
            memberCoverage:
              recognized === members.size
                ? `${members.size}人独立音轨`
                : `已识别 ${recognized}/${members.size} 人`,
          }
        : {}),
    });
  };
  const assist = record.transcriptionAssist;
  if (assist) {
    for (const id of [assist.cloudModelId, assist.localModelId]) {
      const variant = record.transcriptionVariants?.[id];
      if (variant) add(variant.model, variant.transcript, variant.speakers);
    }
  }
  add(record.transcriptionModel, record.transcript, record.speakers);
  const fusion =
    record.transcriptionAssist?.status === "completed" && record.transcript.length
      ? record.transcriptionFusion
      : undefined;
  const reviewedCount =
    fusion?.transcript.filter(
      (segment) => segment.fusionUncertain === false && !segment.fusionEstimated,
    ).length ?? 0;
  const uncertainCount =
    fusion?.transcript.filter((segment) => segment.fusionUncertain !== false).length ?? 0;
  const localOriginal = assist && record.transcriptionVariants?.[assist.localModelId];
  const comparable = localOriginal?.model.id === assist?.localModelId && localOriginal?.transcript;
  const confirmed = fusion?.status === "completed" && reviewedCount > 0;
  if (fusion?.completedBatches && fusion.transcript.length)
    result.set("fusion", {
      kind: "fusion",
      label: !reviewedCount
        ? "未校对的保留稿"
        : fusion.status === "completed"
          ? `融合稿${uncertainCount ? ` · ${uncertainCount}句待核对` : ""}`
          : `校对中的保留稿 · ${fusion.completedBatches}/${fusion.totalBatches}`,
      transcript: fusion.transcript,
      speakers: fusion.speakers,
      estimated: fusion.transcript.some((segment) => segment.fusionEstimated),
      reviewedCount: confirmed ? reviewedCount : undefined,
      textUnchanged:
        confirmed && comparable && reviewedCount === fusion.transcript.length
          ? comparable.length === fusion.transcript.length &&
            fusion.transcript.every(
              (segment, index) =>
                segment.id === comparable[index]?.id && segment.text === comparable[index]?.text,
            )
          : undefined,
    });
  if (!result.has("cloud") && !result.has("local") && record.transcript.length)
    result.set("unknown", {
      kind: "unknown",
      label: "历史原稿（模型来源未记录）",
      transcript: record.transcript,
      speakers: record.speakers,
      estimated: true,
    });
  return [...result.values()];
}
export function resolveTranscriptView(
  record?: VoiceMemoryRecord,
  choice: TranscriptViewChoice = "auto",
): TranscriptView | undefined {
  const options = transcriptViewOptions(record);
  const preferFusion =
    record?.transcriptionFusion?.status === "completed" &&
    record.transcriptionFusion.transcript.some(
      (segment) => segment.fusionUncertain === false && !segment.fusionEstimated,
    );
  return (
    options.find((option) => option.kind === choice) ??
    (preferFusion ? options.find((option) => option.kind === "fusion") : undefined) ??
    (record?.transcriptionAssist ? options.find((option) => option.kind === "cloud") : undefined) ??
    options.find((option) => option.kind !== "fusion")
  );
}
