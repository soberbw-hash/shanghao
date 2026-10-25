import type { AiTranscriptionProvider } from "@private-voice/shared";

/** Briefly describe the selected transcription destination. */
export function TranscriptionDataNotice({
  provider,
  automatic,
}: {
  provider: AiTranscriptionProvider;
  automatic: boolean;
}) {
  return (
    <aside
      className="transcription-data-notice w-full text-sm leading-6 text-[var(--sg-ink-1)]"
      role="note"
    >
      {provider === "local"
        ? "音频在本机转录，随后自动生成摘要；上传需手动操作。"
        : `${automatic ? "保存后自动转录并生成摘要。" : "转录后自动生成摘要。"}音频发送至${provider === "cloud" ? "硅基流动" : "自定义服务"}；原录音保留本机，摘要不自动上传。`}
    </aside>
  );
}
