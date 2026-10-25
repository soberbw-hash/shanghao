import type { VoiceMemoryOrganizationChunk, VoiceMemoryRecord } from "@private-voice/shared";

/** Cloud wording is supporting evidence only; local source IDs and timings stay authoritative. */
export function hybridOrganizationContext(
  record: VoiceMemoryRecord,
  chunk: Pick<VoiceMemoryOrganizationChunk, "startMs" | "endMs">,
): string {
  if (record.transcriptionAssist?.status !== "completed") return "";
  const cloud = record.transcriptionVariants?.[record.transcriptionAssist.cloudModelId];
  const fused =
    record.transcriptionFusion?.status === "completed" ? record.transcriptionFusion : undefined;
  const relevant = (fused ?? cloud)?.transcript.filter(
    (segment) => segment.startMs < chunk.endMs && segment.endMs > chunk.startMs,
  );
  if (!relevant?.length) return "";
  const text = relevant
    .map((segment) => `${segment.fusionUncertain ? "[待核对] " : ""}${segment.text}`)
    .join("\n");
  return [
    fused
      ? "下面是相同范围的融合校对稿。标记不确定的句子仍须谨慎，不得当作确定事实。"
      : "下面是相同时间范围的第二份云端识别，作为校对参照，可能有错字、漏字及粗略时间。",
    "请交叉核对、去重；冲突且无法确认时明确保留不确定，不得虚构说话人。回听引用只用上面的本地原文 ID 和时间。",
    "参照文字：",
    text.slice(0, 1800),
    text.length > 1800 ? "（参照文字已节选；完整两份结果仍保存在本机。）" : "",
  ].join("\n");
}
