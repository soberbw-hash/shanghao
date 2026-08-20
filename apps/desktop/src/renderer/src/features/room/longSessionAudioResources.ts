import type { MeshPeerConnection } from "@private-voice/webrtc";
import { getRemoteAudioMixer } from "../audio/RemoteAudioMixer";

export const collectLongSessionAudioResources = (
  localStream: MediaStream,
  peers: ReadonlyMap<string, MeshPeerConnection>,
) => {
  const mixer = getRemoteAudioMixer().getDiagnostics();
  return {
    peerConnectionCount: peers.size,
    trackCount:
      localStream.getTracks().length +
      [...peers.values()].reduce(
        (total, peer) => total + peer.connection.getReceivers().filter((item) => item.track).length,
        0,
      ),
    mixerInputCount: mixer.webrtcChannelCount + mixer.relayChannelCount,
    audioNodeCount: mixer.audioNodeCount,
    audioContextCount: mixer.audioContextCount,
    timerCount: mixer.timerCount,
  };
};
