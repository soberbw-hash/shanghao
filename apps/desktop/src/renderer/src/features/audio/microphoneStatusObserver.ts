import { MICROPHONE_INPUT_LOST } from "./microphoneInputLoss";
import type { MicrophoneTrackStatus } from "./microphoneStatus";

export interface MicrophoneStreamStatus {
  tracks: MicrophoneTrackStatus[];
  inputLost: boolean;
}

/** Read-only observation of the current stream and the existing raw-input loss signal. */
export const observeMicrophoneStatus = (
  stream: MediaStream,
  events: EventTarget,
  update: (status: MicrophoneStreamStatus) => void,
): (() => void) => {
  let inputLost = false;
  const tracks = stream.getAudioTracks();
  const publish = () =>
    update({
      tracks: stream
        .getAudioTracks()
        .map(({ readyState, enabled, muted }) => ({ readyState, enabled, muted })),
      inputLost,
    });
  const lost = (event: Event) => {
    if ((event as CustomEvent<MediaStream>).detail !== stream) return;
    inputLost = true;
    publish();
  };
  tracks.forEach((track) => {
    for (const name of ["ended", "mute", "unmute"]) track.addEventListener(name, publish);
  });
  stream.addEventListener("removetrack", publish);
  events.addEventListener(MICROPHONE_INPUT_LOST, lost);
  publish();
  return () => {
    tracks.forEach((track) => {
      for (const name of ["ended", "mute", "unmute"]) track.removeEventListener(name, publish);
    });
    stream.removeEventListener("removetrack", publish);
    events.removeEventListener(MICROPHONE_INPUT_LOST, lost);
  };
};
