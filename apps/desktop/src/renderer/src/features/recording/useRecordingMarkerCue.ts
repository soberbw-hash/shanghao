import { useEffect, useState } from "react";
import {
  recordingMarkerPresentation,
  type RecordingMarkerCueProps,
} from "./recordingMarkerPresentation";
import { formatRecordingMarkerLabel } from "./recordingMarkerLabel";
export type { RecordingMarkerCueProps } from "./recordingMarkerPresentation";

/** Own the transient playback hint independently of persistent timeline labels. */
export const useRecordingMarkerCue = (props: RecordingMarkerCueProps) => {
  const presentation = recordingMarkerPresentation(props);
  const signature = presentation.nearby.map((marker) => marker.id).join("|");
  const [expired, setExpired] = useState("");
  useEffect(() => {
    if (!signature) {
      setExpired("");
      return;
    }
    const timer = window.setTimeout(() => setExpired(signature), 2500);
    return () => window.clearTimeout(timer);
  }, [signature]);
  return {
    position: presentation.position,
    nearby:
      expired === signature
        ? []
        : presentation.nearby.map((marker) => ({
            ...marker,
            label: formatRecordingMarkerLabel(marker.label ?? ""),
          })),
  };
};
