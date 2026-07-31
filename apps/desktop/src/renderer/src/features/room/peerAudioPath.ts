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
  nowMs: number;
  relayWarmupUntilMs?: number;
}

/**
 * Late joiners keep a short relay overlap even after WebRTC reports healthy.
 * This avoids dropping the only audible path while every existing peer is
 * still converging on the new member's RTP state.
 */
export const shouldSendAudioRelay = ({
  evidence,
  isRelayRequested,
  nowMs,
  relayWarmupUntilMs = 0,
}: PeerAudioRelayDecision): boolean =>
  isRelayRequested || nowMs < relayWarmupUntilMs || shouldUseAudioRelay(evidence);
