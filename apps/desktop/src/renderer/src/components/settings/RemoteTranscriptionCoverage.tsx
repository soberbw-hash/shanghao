import type { VoiceMemoryRecord } from "@private-voice/shared";

export function RemoteTranscriptionCoverage({ record }: { record: VoiceMemoryRecord }) {
  const remote = record.remoteTranscription;
  if (!remote || record.phase === "transcribing" || record.phase === "paused") return null;
  const empty = remote.parts.filter((part) => !part.text.trim()).length;
  const expected =
    remote.sources?.reduce((sum, source) => sum + Math.ceil(source.durationMs / 300000), 0) ??
    Math.ceil(remote.audioDurationMs / 300000);
  return (
    <p className="mt-1 text-xs leading-5 text-[#718096]">
      云端已处理 {remote.parts.length}/{expected} 段。
      {remote.sources ? "已按成员独立音轨绑定昵称；音轨缺失的内容无法据此恢复。" : ""}
      {empty
        ? `${empty} 段未返回文字，可能是静音或漏识别；可开启本地辅助复核。`
        : "请求完成不代表每句话都准确识别，可用本地辅助复核。"}
    </p>
  );
}
