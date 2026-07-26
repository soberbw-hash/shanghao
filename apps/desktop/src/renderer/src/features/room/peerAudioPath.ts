export interface PeerAudioPathEvidence {
  isConnected: boolean;
  hasAudioTrack: boolean;
  hasInboundRtpFlow: boolean;
  isStalled: boolean;
}

/**
 * A live MediaStreamTrack is only an SDP promise. Keep the signaling relay
 * active until inbound RTP counters prove that audio is actually arriving.
 */
export const isPeerAudioPathReady = (evidence: PeerAudioPathEvidence): boolean =>
  evidence.isConnected &&
  evidence.hasAudioTrack &&
  evidence.hasInboundRtpFlow &&
  !evidence.isStalled;

export const shouldUseAudioRelay = (evidence: PeerAudioPathEvidence): boolean =>
  !isPeerAudioPathReady(evidence);
