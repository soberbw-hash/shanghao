import type {
  ScreenFrameMessage,
  ScreenPathStateMessage,
  ScreenShareStateMessage,
  SignalEnvelope,
} from "@private-voice/signaling";
import {
  DEFAULT_SCREEN_SHARE_PROFILE,
  type MeshPeerConnection,
  type ScreenShareEncodingProfile,
} from "@private-voice/webrtc";

import { writeRendererLog } from "../../utils/logger";
import type { RemoteScreenFrame } from "../room/roomClient";
import { ScreenFrameRelay } from "./ScreenFrameRelay";
import {
  ScreenSharePipelineController,
  type ScreenSharePipelineSnapshot,
} from "./ScreenSharePipelineController";

// Four relay frames per second keeps the fallback usable while the relay's
// single-flight capture prevents JPEG/IPC work from overlapping.
const SCREEN_FRAME_INTERVAL_MS = 250;
const SCREEN_DIAGNOSTICS_INTERVAL_MS = 2_000;
const SCREEN_TRACK_RECOVERY_DELAY_MS = 1_500;

interface RoomScreenShareCoordinatorOptions {
  roomId: string;
  peerId: string;
  getPeers: () => Map<string, MeshPeerConnection>;
  getRemotePeerIds: () => Set<string>;
  getWebRtcScreenPeerIds: () => Set<string>;
  getPrimaryInputTrack: () => MediaStreamTrack | undefined;
  applyScreenAudioMix: (
    microphoneTrack: MediaStreamTrack,
    systemAudioTrack: MediaStreamTrack,
  ) => Promise<void>;
  restorePrimaryInputTrack: () => Promise<void>;
  safeSend: (payload: SignalEnvelope) => Promise<boolean>;
  onRemoteFrame: (peerId: string, frame?: RemoteScreenFrame) => void;
  onRemoteState: (peerId: string, isSharing: boolean) => void;
  onScreenTrackLost: (peerId: string) => void;
}

/** Owns local/remote screen-share state and the signaling-frame fallback path. */
export class RoomScreenShareCoordinator {
  private stream?: MediaStream;
  private profile = DEFAULT_SCREEN_SHARE_PROFILE;
  private readonly remoteSharingPeerIds = new Set<string>();
  private readonly relayRequestedByPeerIds = new Set<string>();
  private readonly advertisedRelayNeeds = new Map<string, boolean>();
  private readonly relay: ScreenFrameRelay;
  private readonly pipeline = new ScreenSharePipelineController();
  private readonly screenRecoveryTimers = new Map<string, number>();
  private diagnosticsTimer?: number;

  constructor(private readonly options: RoomScreenShareCoordinatorOptions) {
    this.relay = new ScreenFrameRelay({
      roomId: options.roomId,
      peerId: options.peerId,
      getTargetPeerIds: () => this.getRelayTargets(),
      send: async (payload) => {
        await options.safeSend(payload);
      },
    });
  }

  get activeStream(): MediaStream | undefined {
    return this.stream;
  }

  get relayActive(): boolean {
    return this.relay.isActive();
  }

  get relayTargetCount(): number {
    return this.getRelayTargets().length;
  }

  get diagnostics(): ScreenSharePipelineSnapshot {
    return this.pipeline.snapshot();
  }

  isRemoteSharing(peerId: string): boolean {
    return this.remoteSharingPeerIds.has(peerId);
  }

  async start(
    stream: MediaStream,
    profile: ScreenShareEncodingProfile = DEFAULT_SCREEN_SHARE_PROFILE,
  ): Promise<void> {
    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack) throw new Error("screen_track_missing");
    if (this.stream) await this.options.restorePrimaryInputTrack();
    this.stopTracks();
    this.relayRequestedByPeerIds.clear();
    this.stream = stream;
    this.profile = profile;
    this.pipeline.setLocalCapture(videoTrack, profile);
    this.ensureDiagnosticsSampling();
    const systemAudioTrack = stream.getAudioTracks()[0];
    const microphoneTrack = this.options.getPrimaryInputTrack();
    if (systemAudioTrack && microphoneTrack) {
      await this.options.applyScreenAudioMix(microphoneTrack, systemAudioTrack);
    }
    this.updateRelay();
    void this.options.safeSend({
      type: "screen_share_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isSharing: true,
    });
    videoTrack.addEventListener("ended", () => void this.stop(false), { once: true });
    await Promise.all(
      [...this.options.getPeers().values()].map((peer) => peer.setScreenTrack(videoTrack, profile)),
    );
    void writeRendererLog("webrtc", "info", "Screen share track attached", {
      peerCount: this.options.getPeers().size,
      trackId: videoTrack.id,
      settings: videoTrack.getSettings?.(),
      profile,
    });
  }

  async stop(stopTracks = true): Promise<void> {
    const previousStream = this.stream;
    this.stream = undefined;
    this.relayRequestedByPeerIds.clear();
    this.relay.stop();
    this.pipeline.clearLocalCapture();
    await Promise.all(
      [...this.options.getPeers().values()].map((peer) => peer.setScreenTrack(undefined)),
    );
    await this.options.restorePrimaryInputTrack();
    if (stopTracks) previousStream?.getTracks().forEach((track) => track.stop());
    void this.options.safeSend({
      type: "screen_share_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isSharing: false,
    });
    void writeRendererLog("webrtc", "info", "Screen share track detached", {
      peerCount: this.options.getPeers().size,
    });
    this.stopDiagnosticsSamplingIfIdle();
  }

  handleFrame(payload: ScreenFrameMessage): void {
    if (payload.peerId === this.options.peerId) return;
    if (payload.targetPeerIds && !payload.targetPeerIds.includes(this.options.peerId)) return;
    this.options.onRemoteFrame(payload.peerId, {
      data: payload.data,
      width: payload.width,
      height: payload.height,
      sequence: payload.sequence,
      receivedAt: new Date().toISOString(),
    });
  }

  handleRemoteState(payload: ScreenShareStateMessage): void {
    if (payload.peerId === this.options.peerId) return;
    if (payload.isSharing) {
      this.remoteSharingPeerIds.add(payload.peerId);
      this.options.onRemoteState(payload.peerId, true);
      this.ensureDiagnosticsSampling();
      this.advertisePath(
        payload.peerId,
        !this.options.getWebRtcScreenPeerIds().has(payload.peerId),
        "screen_share_started",
      );
      return;
    }
    this.remoteSharingPeerIds.delete(payload.peerId);
    this.options.getWebRtcScreenPeerIds().delete(payload.peerId);
    this.options.onRemoteState(payload.peerId, false);
    this.advertisePath(payload.peerId, false, "screen_share_stopped");
    this.options.onRemoteFrame(payload.peerId, undefined);
    this.clearScreenRecoveryTimer(payload.peerId);
    this.stopDiagnosticsSamplingIfIdle();
  }

  handlePathState(payload: ScreenPathStateMessage): void {
    if (
      payload.targetPeerId !== this.options.peerId ||
      !this.options.getRemotePeerIds().has(payload.peerId)
    ) {
      return;
    }
    if (payload.needsRelay) this.relayRequestedByPeerIds.add(payload.peerId);
    else this.relayRequestedByPeerIds.delete(payload.peerId);
    this.updateRelay();
  }

  syncPeerTrack(peerId: string, hasLiveScreen: boolean): void {
    if (!this.remoteSharingPeerIds.has(peerId)) return;
    if (hasLiveScreen) {
      this.clearScreenRecoveryTimer(peerId);
    } else if (!this.screenRecoveryTimers.has(peerId)) {
      this.screenRecoveryTimers.set(
        peerId,
        window.setTimeout(() => {
          this.screenRecoveryTimers.delete(peerId);
          if (
            this.remoteSharingPeerIds.has(peerId) &&
            !this.options.getWebRtcScreenPeerIds().has(peerId)
          ) {
            this.options.onScreenTrackLost(peerId);
          }
        }, SCREEN_TRACK_RECOVERY_DELAY_MS),
      );
    }
    this.advertisePath(
      peerId,
      !hasLiveScreen,
      hasLiveScreen ? "webrtc_screen_track_ready" : "webrtc_screen_track_unavailable",
    );
  }

  async applyToPeer(peer: MeshPeerConnection): Promise<void> {
    const [track] = this.stream?.getVideoTracks() ?? [];
    if (track?.readyState === "live") await peer.setScreenTrack(track, this.profile);
  }

  notifyPeer(_peerId: string): void {
    if (!this.stream) return;
    void this.options.safeSend({
      type: "screen_share_state",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      isSharing: true,
    });
  }

  clearPeer(peerId: string): void {
    this.remoteSharingPeerIds.delete(peerId);
    this.relayRequestedByPeerIds.delete(peerId);
    this.advertisedRelayNeeds.delete(peerId);
    this.clearScreenRecoveryTimer(peerId);
    this.pipeline.clearPeer(peerId);
  }

  prune(activePeerIds: Set<string>): void {
    for (const peerId of new Set([
      ...this.remoteSharingPeerIds,
      ...this.relayRequestedByPeerIds,
      ...this.advertisedRelayNeeds.keys(),
    ])) {
      if (!activePeerIds.has(peerId)) {
        if (this.remoteSharingPeerIds.has(peerId)) this.options.onRemoteState(peerId, false);
        this.clearPeer(peerId);
      }
    }
    this.updateRelay();
  }

  clear(): void {
    this.remoteSharingPeerIds.clear();
    this.relayRequestedByPeerIds.clear();
    this.advertisedRelayNeeds.clear();
    this.relay.stop();
    for (const peerId of this.screenRecoveryTimers.keys()) this.clearScreenRecoveryTimer(peerId);
    this.stopDiagnosticsSampling();
    this.pipeline.clear();
  }

  stopTracks(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.relay.stop();
    this.pipeline.clearLocalCapture();
    this.stopDiagnosticsSamplingIfIdle();
  }

  private advertisePath(peerId: string, needsRelay: boolean, reason: string): void {
    if (!this.options.getRemotePeerIds().has(peerId)) return;
    if (this.advertisedRelayNeeds.get(peerId) === needsRelay) return;
    this.advertisedRelayNeeds.set(peerId, needsRelay);
    void this.options
      .safeSend({
        type: "screen_path_state",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
        targetPeerId: peerId,
        needsRelay,
        reason,
      })
      .catch(() => this.advertisedRelayNeeds.delete(peerId));
  }

  private getRelayTargets(): string[] {
    return [...this.relayRequestedByPeerIds].filter((peerId) =>
      this.options.getRemotePeerIds().has(peerId),
    );
  }

  private updateRelay(): void {
    const targets = this.getRelayTargets();
    if (this.stream && targets.length && !this.relay.isRunningAt(SCREEN_FRAME_INTERVAL_MS)) {
      this.relay.start(this.stream, SCREEN_FRAME_INTERVAL_MS);
    } else if ((!this.stream || !targets.length) && this.relay.isActive()) {
      this.relay.stop();
    }
    this.pipeline.setFallback(this.relay.isActive(), targets.length);
  }

  private ensureDiagnosticsSampling(): void {
    if (this.diagnosticsTimer !== undefined) return;
    const sample = () =>
      void this.pipeline.sample(this.options.getPeers(), this.remoteSharingPeerIds).catch((error) =>
        writeRendererLog("webrtc", "warn", "Screen share stats sampling failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    sample();
    this.diagnosticsTimer = window.setInterval(sample, SCREEN_DIAGNOSTICS_INTERVAL_MS);
  }

  private stopDiagnosticsSamplingIfIdle(): void {
    if (!this.stream && this.remoteSharingPeerIds.size === 0) this.stopDiagnosticsSampling();
  }

  private stopDiagnosticsSampling(): void {
    if (this.diagnosticsTimer !== undefined) window.clearInterval(this.diagnosticsTimer);
    this.diagnosticsTimer = undefined;
  }

  private clearScreenRecoveryTimer(peerId: string): void {
    const timer = this.screenRecoveryTimers.get(peerId);
    if (timer !== undefined) window.clearTimeout(timer);
    this.screenRecoveryTimers.delete(peerId);
  }
}
