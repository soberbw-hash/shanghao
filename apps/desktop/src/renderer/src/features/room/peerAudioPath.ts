export interface PeerAudioPathEvidence {
  isConnected: boolean;
  hasAudioTrack: boolean;
  hasInboundRtpFlow: boolean;
  hasPlaybackChannel: boolean;
  isStalled: boolean;
}

/**
 * A live MediaStreamTrack is only an SDP promise. Keep the signaling relay
 * active until RTP is arriving and the remote track is attached to the shared
 * playback graph. Packet counters alone do not prove that a user can hear it.
 */
export const isPeerAudioPathReady = (evidence: PeerAudioPathEvidence): boolean =>
  evidence.isConnected &&
  evidence.hasAudioTrack &&
  evidence.hasInboundRtpFlow &&
  evidence.hasPlaybackChannel &&
  !evidence.isStalled;

export const shouldUseAudioRelay = (evidence: PeerAudioPathEvidence): boolean =>
  !isPeerAudioPathReady(evidence);

export interface PeerAudioRelayDecision {
  evidence: PeerAudioPathEvidence;
  isRelayRequested: boolean;
}

/**
 * Relay is directed only to peers that requested it or whose WebRTC playback
 * has not been verified by decoded PCM. A connected track alone is not enough.
 */
export const shouldSendAudioRelay = ({
  evidence,
  isRelayRequested,
}: PeerAudioRelayDecision): boolean => isRelayRequested || shouldUseAudioRelay(evidence);
