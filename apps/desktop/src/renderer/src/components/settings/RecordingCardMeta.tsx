import { formatRecordingBytes } from "../../features/recording/recordingSize";
import { recordingTimePeriod } from "../../features/recording/recordingTimePeriod";
import { recordingDurationLabel } from "../../features/recording/recordingDurationLabel";

export const RecordingCardMeta = ({
  dateTime,
  recordedAt,
  duration,
  bytes,
}: {
  dateTime: string;
  recordedAt: string;
  duration: number | null | undefined;
  bytes: number;
}) => (
  <span className="recording-item-meta">
    <time dateTime={dateTime}>
      录制时间 {recordingTimePeriod(dateTime)} {recordedAt}
    </time>
    <span>
      <span>{recordingDurationLabel(duration)}</span>
      <span>{formatRecordingBytes(bytes)}</span>
    </span>
  </span>
);
