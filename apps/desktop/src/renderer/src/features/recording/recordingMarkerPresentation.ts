import type { RecordingMarker } from "@private-voice/shared";

export interface RecordingMarkerCueProps {
  markers: RecordingMarker[];
  currentTime: number;
  duration: number;
}

export const recordingMarkerPresentation = ({
  markers,
  currentTime,
  duration,
}: RecordingMarkerCueProps) => ({
  nearby: markers.filter(
    (marker) => marker.label && Math.abs(marker.offsetMs / 1_000 - currentTime) <= 1.5,
  ),
  position: Math.max(15, Math.min(85, duration ? (currentTime / duration) * 100 : 50)),
});
