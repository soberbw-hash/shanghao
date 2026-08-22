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

export interface RelayResyncEvidence {
  now: number;
  lastReceivedAt?: number;
  lastPlayedAt?: number;
  lastResyncRequestedAt?: number;
  lastResyncReceivedAt?: number;
}

const RELAY_RESYNC_RECENT_RECEIVE_MS = 3_000;
const RELAY_RESYNC_COOLDOWN_MS = 5_000;

/**
 * Silence after the last successfully played relay packet is normal because the
 * relay voice gate stops sending quiet audio. Resync only when newer packets are
 * still arriving without being played, and rate-limit the recovery handshake.
 */
export const shouldRequestRelayResync = ({
  now,
  lastReceivedAt,
  lastPlayedAt,
  lastResyncRequestedAt,
  lastResyncReceivedAt,
}: RelayResyncEvidence): boolean => {
  if (lastReceivedAt === undefined || now - lastReceivedAt > RELAY_RESYNC_RECENT_RECEIVE_MS) {
    return false;
  }
  if (lastPlayedAt !== undefined && lastReceivedAt <= lastPlayedAt) return false;
  if (lastResyncReceivedAt !== undefined && lastReceivedAt <= lastResyncReceivedAt) return false;
  if (
    lastResyncRequestedAt !== undefined &&
    now - lastResyncRequestedAt < RELAY_RESYNC_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
};
