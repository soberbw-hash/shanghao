import type { VoiceMemoryRecord } from "@private-voice/shared";

export const TranscriptionTimingNotice = ({ record }: { record: VoiceMemoryRecord }) =>
  ["siliconflow-sensevoice-small", "custom-asr-api"].includes(
    record.transcriptionModel?.id ?? "",
  ) ? (
    <p className="mt-2 text-xs leading-5 text-[#718096]" role="note">
      云端接口返回纯文本，以下时间为片段内估算位置，点击回听会定位到附近。需要逐句准确时间轴时，请使用本地转录模型。
    </p>
  ) : null;
