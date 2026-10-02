import { RecordingState } from "@private-voice/shared";
import { useRecordingStore } from "../../store/recordingStore";
import { useSettingsStore } from "../../store/settingsStore";

/** Write game transitions only into the active local recording. */
export const addGameRecordingEvents = (
  before: string | undefined,
  next: string | undefined,
): void => {
  const recording = useRecordingStore.getState();
  if (
    before === next ||
    recording.status.state !== RecordingState.Recording ||
    !recording.status.startedAt ||
    useSettingsStore.getState().settings?.isRecordingAutoGameMarkerEnabled === false
  )
    return;
  const now = Date.now();
  const time = new Date(now).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  for (const label of [
    before ? `退出了${before}` : undefined,
    next ? `启动了${next}` : undefined,
  ]) {
    if (!label || useRecordingStore.getState().markers.length >= 2_000) continue;
    recording.addMarker({
      id: crypto.randomUUID(),
      createdAt: new Date(now).toISOString(),
      offsetMs: Math.max(0, now - recording.status.startedAt),
      label: `${time} ${label}`,
    });
  }
};
