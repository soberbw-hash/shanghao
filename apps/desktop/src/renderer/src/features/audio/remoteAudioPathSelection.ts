export type RemoteAudioMediaPath = "webrtc" | "relay";

export interface RemoteAudioPathAvailability {
  requestedPath?: RemoteAudioMediaPath;
  hasWebRtcChannel: boolean;
  hasVerifiedWebRtcAudio: boolean;
  hasRelayChannel: boolean;
}

/**
 * A requested transport is not necessarily attached to the playback graph yet.
 * Keep whichever path can actually produce sound active while late joiners and
 * repaired peer connections converge.
 */
export const resolveRemoteAudioPath = ({
  requestedPath,
  hasWebRtcChannel,
  hasVerifiedWebRtcAudio,
  hasRelayChannel,
}: RemoteAudioPathAvailability): RemoteAudioMediaPath => {
  if (requestedPath === "webrtc" && hasVerifiedWebRtcAudio) return "webrtc";
  if (requestedPath === "relay" && hasRelayChannel) return "relay";
  if (hasVerifiedWebRtcAudio) return "webrtc";
  if (hasRelayChannel) return "relay";
  if (hasWebRtcChannel) return "webrtc";
  return requestedPath ?? "relay";
};
