import type {
  VoiceMemoryRecord,
  VoiceMemoryTranscriptionModel,
  VoiceMemoryTranscriptSegment,
  VoiceMemorySpeaker,
} from "@private-voice/shared";
export type TranscriptViewChoice =
  | "auto"
  | "fusion"
  | "cloud"
  | "local"
  | "unknown"
  | `history:${string}`
  | `history-original:${string}`;
export interface TranscriptView {
  kind: Exclude<TranscriptViewChoice, "auto">;
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
  const confirmed =
    fusion?.verificationPolicy === "agreement-v1" &&
    fusion.status === "completed" &&
    reviewedCount > 0;
  if (fusion?.completedBatches && fusion.transcript.length)
    result.set("fusion", {
      kind: "fusion",
      label:
        fusion.verificationPolicy !== "agreement-v1"
          ? "历史融合稿 · 建议回听核对"
          : !reviewedCount
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
  for (const entry of record.transcriptionFusionHistory ?? []) {
    if (!entry.fusion.transcript.length) continue;
    const kind = `history:${entry.id}` as const;
    result.set(kind, {
      kind,
      label: `历史融合稿 · ${entry.archivedAt.slice(0, 10)}`,
      transcript: entry.fusion.transcript,
      speakers: entry.fusion.speakers,
      estimated: entry.fusion.transcript.some((segment) => segment.fusionEstimated),
    });
  }
  for (const entry of record.transcriptionOriginalHistory ?? []) {
    if (!entry.transcript.length) continue;
    const kind = `history-original:${entry.id}` as const;
    result.set(kind, {
      kind,
      label: `历史原稿 · ${entry.model?.name ?? "来源未知"} · ${entry.archivedAt.slice(0, 10)}`,
      model: entry.model,
      transcript: entry.transcript,
      speakers: entry.speakers,
      estimated: entry.model ? isCloud(entry.model.id) : true,
    });
  }
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
    record?.transcriptionFusion?.verificationPolicy === "agreement-v1" &&
    record.transcriptionFusion.status === "completed" &&
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
