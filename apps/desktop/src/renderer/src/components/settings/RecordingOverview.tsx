import type { VoiceMemoryRecord } from "@private-voice/shared";
import { ChevronDown, RotateCcw } from "lucide-react";

interface RecordingOverviewProps {
  record: VoiceMemoryRecord;
  busy: boolean;
  onRetry: () => void;
  onSeek: (offsetMs: number) => void;
}
export function RecordingOverview({ record, busy, onRetry, onSeek }: RecordingOverviewProps) {
  if (!record.transcript.length) return null;
  const organization = record.organization;
  const complete = organization ? organization.status === "completed" : !!record.organizedAt;
  const description = complete ? organization?.finalResult?.description : undefined;
  const points = complete ? record.summary.slice(0, 3) : [];
  const failed =
    record.errorMessage?.startsWith("organize_failed:") ||
    ["failed", "unrecoverable"].includes(organization?.status ?? "");
  const paused = record.phase === "paused" && record.processingStage === "organize";
  const missing = !organization && record.phase === "ready" && !record.summary.length;
  if (description || points.length)
    return (
      <details className="recording-overview" aria-label="录音概览">
        <summary>
          <strong>摘要</strong>
          <span>{description || points[0]?.text}</span>
          <ChevronDown aria-hidden="true" />
        </summary>
        {description ? <p>{description}</p> : null}
        {points.length ? (
          <ul>
            {points.map(({ text, sourceStartMs }, index) => (
              <li key={`${index}:${text}`}>
                {sourceStartMs === undefined ? (
                  text
                ) : (
                  <button type="button" onClick={() => onSeek(sourceStartMs)}>
                    {text}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    );
  return (
    <div className="recording-overview recording-overview-pending" aria-label="录音概览">
      <strong>摘要</strong>
      <span className="recording-overview-status" role="status">
        {failed
          ? "生成失败，文字稿已保留"
          : missing
            ? "还没有摘要"
            : paused
              ? "已暂停"
              : record.phase === "transcribing"
                ? "转录完成后生成"
                : record.transcriptionFusion?.status === "running"
                  ? "校对完成后生成"
                  : "云端生成中…"}
      </span>
      {failed || paused || missing ? (
        <button type="button" disabled={busy} onClick={onRetry}>
          <RotateCcw aria-hidden="true" />
          {paused ? "继续生成" : missing ? "补生成摘要" : "重试摘要"}
        </button>
      ) : null}
    </div>
  );
}
