import * as cue from "../../features/recording/useRecordingMarkerCue";
export const RecordingMarkerCue = (props: cue.RecordingMarkerCueProps) => {
  const { nearby } = cue.useRecordingMarkerCue(props);
  if (!nearby.length) return null;
  return (
    <output className="recording-marker-cue">
      {nearby.map((marker) => (
        <span key={marker.id}>{marker.label}</span>
      ))}
    </output>
  );
};
