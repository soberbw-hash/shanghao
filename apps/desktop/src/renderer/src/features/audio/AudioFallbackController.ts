import type {
  AudioChunkMessage,
  AudioResyncAckMessage,
  AudioResyncRequestMessage,
} from "@private-voice/signaling";

import { SignalingAudioRelay, type SignalingAudioRelayOptions } from "../room/signalingAudioRelay";

/**
 * Owns the signaling-audio fallback lifecycle so RoomClient only decides
 * which peers need fallback instead of managing capture and playback details.
 */
export class AudioFallbackController {
  private readonly relay: SignalingAudioRelay;

  constructor(options: SignalingAudioRelayOptions) {
    this.relay = new SignalingAudioRelay(options);
  }

  start(): Promise<void> {
    return this.relay.start();
  }

  setMuted(isMuted: boolean): void {
    this.relay.setMuted(isMuted);
  }

  setShouldSend(shouldSend: boolean): void {
    this.relay.setShouldSend(shouldSend);
  }

  setServerClockOffsetMs(offsetMs: number): void {
    this.relay.setServerClockOffsetMs(offsetMs);
  }

  replaceLocalStream(stream: MediaStream): Promise<void> {
    return this.relay.replaceLocalStream(stream);
  }

  handleRemoteChunk(message: AudioChunkMessage): void {
    this.relay.handleRemoteChunk(message);
  }

  handleResyncRequest(message: AudioResyncRequestMessage): void {
    this.relay.handleResyncRequest(message);
  }

  handleResyncAck(message: AudioResyncAckMessage): void {
    this.relay.handleResyncAck(message);
  }

  clearPeer(peerId: string, reason: string): void {
    this.relay.clearPeer(peerId, reason);
  }

  markPeerPath(peerId: string, path: "webrtc" | "relay", reason: string): void {
    this.relay.markPeerPath(peerId, path, reason);
  }

  resetTransport(reason: string): void {
    this.relay.resetTransport(reason);
  }

  getDiagnostics(): ReturnType<SignalingAudioRelay["getDiagnostics"]> {
    return this.relay.getDiagnostics();
  }

  destroy(): void {
    this.relay.destroy();
  }
}
