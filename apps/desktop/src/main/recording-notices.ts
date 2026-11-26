import type { RecordingNotice, VoiceMemoryRecord, VoiceReplayClip } from "@private-voice/shared";

export function savedReplayNotice(clip: VoiceReplayClip): RecordingNotice {
  const seconds = Math.floor(clip.durationMs / 1000);
  return {
    kind: "voice-replay",
    clipId: clip.id,
    title: seconds ? `已保存刚才的 ${seconds} 秒` : "已保存刚才的语音",
    body: "片段已存入精彩片段，可回听或转成文字。",
  };
}

export function transcriptNotice(record: VoiceMemoryRecord): RecordingNotice {
  const duration =
    record.transcriptionStats?.audioDurationMs ?? record.remoteTranscription?.audioDurationMs;
  const seconds = Math.floor((duration ?? 0) / 1000);
  const details: string[] = [];
  if (seconds) {
    const minutes = Math.floor(seconds / 60);
    details.push(minutes ? `录音 ${minutes} 分 ${seconds % 60} 秒` : `录音 ${seconds} 秒`);
  }
  const members = new Set(record.transcript.map((segment) => segment.memberId).filter(Boolean));
  if (members.size) details.push(`${members.size} 位已识别成员发言`);
  details.push(`${record.transcript.length} 段文字`);
  return {
    kind: "transcription",
    filePath: record.filePath,
    title: "本次录音的文字稿已生成",
    body: details.join(" · "),
  };
}
