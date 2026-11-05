import type { VoiceMemoryRecord } from "@private-voice/shared";

/** Keep a lack of output distinct from evidence that a recording contains no speech. */
export function describeEmptyTranscription(record: VoiceMemoryRecord, complete: boolean) {
  if (!complete)
    return { code: "partial_transcription", message: "部分音频分块处理失败，未得到完整转录。" };
  if ((record.transcriptionStats?.emptyOutputOnSpeechUnits ?? 0) > 0)
    return {
      code: "empty_output_on_speech",
      message: "检测到声音但模型没有产生有效文字；可能是非语音，可回听确认。",
    };
  if (record.transcriptionUnits?.some((unit) => unit.outputStatus === "quiet_audio_uncertain"))
    return {
      code: "quiet_audio_uncertain",
      message: "低音量区间无法确认是否有讲话，请回听原录音。",
    };
  return { code: "no_reliable_speech", message: "没有检测到可识别的人声。" };
}
