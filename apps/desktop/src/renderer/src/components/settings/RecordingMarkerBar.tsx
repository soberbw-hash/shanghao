import { Flag, Scissors } from "lucide-react";
import type { RecordingLibraryItem } from "@private-voice/shared";

const timeLabel = (ms: number) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1_000) % 60).padStart(2, "0")}`;

export const RecordingMarkerBar = ({
  recording,
  currentTimeMs,
  onSeek,
  editing,
  onToggle,
}: {
  recording: RecordingLibraryItem;
  currentTimeMs: number;
  onSeek: (ms: number) => void;
  editing: boolean;
  onToggle: () => void;
}) => {
  const markers = [...recording.markers].sort((a, b) => a.offsetMs - b.offsetMs);
  return (
    <div className="recording-marker-bar" aria-label="录音标记">
      <span className="recording-marker-count">
        <Flag aria-hidden="true" /> {markers.length}
      </span>
      <div className="recording-marker-times" aria-label="选择标记时间">
        {markers.map((marker) => (
          <button
            type="button"
            key={marker.id}
            aria-pressed={Math.abs(marker.offsetMs - currentTimeMs) < 1500}
            title={marker.label ?? "标记"}
            onClick={() => onSeek(marker.offsetMs)}
          >
            {timeLabel(marker.offsetMs)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="recording-marker-clip-trigger"
        aria-pressed={editing}
        onClick={onToggle}
      >
        <Scissors aria-hidden="true" /> {editing ? "取消截取" : "截取片段"}
      </button>
    </div>
  );
};
