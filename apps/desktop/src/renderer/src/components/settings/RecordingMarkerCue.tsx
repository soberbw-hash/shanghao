import * as cue from "../../features/recording/recordingMarkerPresentation";
export const RecordingMarkerCue = (props: cue.RecordingMarkerCueProps) => {
  const { nearby, position } = cue.recordingMarkerPresentation(props);
  if (!nearby.length) return null;
  return (
    <output className="recording-marker-cue" style={{ left: `${position}%` }}>
      {nearby.map((marker) => (
        <span key={marker.id}>{marker.label}</span>
      ))}
    </output>
  );
};
