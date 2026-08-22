import type { PeerRestartRequestMessage, SignalEnvelope } from "@private-voice/signaling";
import type { MeshPeerConnection } from "@private-voice/webrtc";

import { writeRendererLog } from "../../utils/logger";
import type { PeerOperationQueue } from "./PeerOperationQueue";

interface PeerRecoveryCoordinatorOptions {
  localPeerId: string;
  roomId: string;
  peers: Map<string, MeshPeerConnection>;
  remotePeerIds: Set<string>;
  connectedPeerIds: Set<string>;
  readyPeerIds: Set<string>;
  operationQueue: PeerOperationQueue;
  canRecover: () => boolean;
  replacePeer: (peerId: string) => MeshPeerConnection;
  applyScreenShare: (peer: MeshPeerConnection) => Promise<void>;
  notifyScreenShare: (peerId: string) => void;
  send: (payload: SignalEnvelope) => Promise<void>;
}

/** Serializes ICE restart and full peer rebuild attempts without changing mesh policy. */
export class PeerRecoveryCoordinator {
  private readonly timers = new Map<string, number>();
  private readonly watchdogs = new Map<string, number>();
  private readonly attempts = new Map<string, number>();
  private readonly lastRecoveryAt = new Map<string, string>();

  constructor(private readonly options: PeerRecoveryCoordinatorOptions) {}

  getAttempts(): ReadonlyMap<string, number> {
    return this.attempts;
  }

  getSnapshot(peerId: string): { count: number; lastRecoveryAt?: string } {
    return {
      count: this.attempts.get(peerId) ?? 0,
      lastRecoveryAt: this.lastRecoveryAt.get(peerId),
    };
  }

  watchConnection(peerId: string, peer: MeshPeerConnection): void {
    const existing = this.watchdogs.get(peerId);
    if (existing) window.clearTimeout(existing);
    const watchdog = window.setTimeout(() => {
      this.watchdogs.delete(peerId);
      if (
        this.options.peers.get(peerId) === peer &&
        !this.options.connectedPeerIds.has(peerId) &&
        this.options.remotePeerIds.has(peerId)
      ) {
        this.schedule(peerId, "connection_timeout");
      }
    }, 8_000);
    this.watchdogs.set(peerId, watchdog);
  }

  schedule(peerId: string, reason: string): void {
    if (
      this.timers.has(peerId) ||
      !this.options.canRecover() ||
      !this.options.remotePeerIds.has(peerId)
    ) {
      return;
    }
    const attempt = (this.attempts.get(peerId) ?? 0) + 1;
    this.attempts.set(peerId, attempt);
    const baseDelay = Math.min(15_000, 1_500 * 2 ** Math.min(3, attempt - 1));
    const delay = baseDelay + Math.floor(Math.random() * 450);
    void writeRendererLog("webrtc", "warn", "Scheduling peer media recovery", {
      targetPeerId: peerId,
      attempt,
      delay,
      reason,
    });
    const timer = window.setTimeout(() => {
      this.timers.delete(peerId);
      this.lastRecoveryAt.set(peerId, new Date().toISOString());
      void this.enqueue(peerId, "recover_peer", () => this.recover(peerId, reason)).catch(
        (error) => {
          void writeRendererLog("webrtc", "warn", "Peer media recovery failed", {
            targetPeerId: peerId,
            attempt,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
          this.schedule(peerId, "recovery_failed");
        },
      );
    }, delay);
    this.timers.set(peerId, timer);
  }

  async handleRemoteRequest(payload: PeerRestartRequestMessage): Promise<void> {
    if (
      payload.targetPeerId !== this.options.localPeerId ||
      !this.options.remotePeerIds.has(payload.peerId)
    ) {
      return;
    }
    await this.enqueue(payload.peerId, "restart_request", async () => {
      if (!this.options.remotePeerIds.has(payload.peerId)) return;
      const forceRebuild = payload.reason.startsWith("rebuild:");
      if (this.options.localPeerId >= payload.peerId) return;
      const existing = this.options.peers.get(payload.peerId);
      if (!forceRebuild && existing) {
        await this.sendIceRestartOffer(
          payload.peerId,
          existing,
          `remote_request:${payload.reason}`,
        );
        this.scheduleRebuild(payload.peerId, payload.reason);
        return;
      }
      const peer = this.options.replacePeer(payload.peerId);
      await this.sendFreshOffer(payload.peerId, peer, `remote_request:${payload.reason}`);
    });
  }

  clear(peerId: string, resetAttempts = false): void {
    const timer = this.timers.get(peerId);
    if (timer) window.clearTimeout(timer);
    this.timers.delete(peerId);
    const watchdog = this.watchdogs.get(peerId);
    if (watchdog) window.clearTimeout(watchdog);
    this.watchdogs.delete(peerId);
    if (resetAttempts) {
      this.attempts.delete(peerId);
      this.lastRecoveryAt.delete(peerId);
    }
  }

  clearAll(): void {
    for (const peerId of new Set([...this.timers.keys(), ...this.watchdogs.keys()])) {
      this.clear(peerId, true);
    }
  }

  private async recover(peerId: string, reason: string, forceRebuild = false): Promise<void> {
    if (!this.options.canRecover() || !this.options.remotePeerIds.has(peerId)) return;
    const existing = this.options.peers.get(peerId);
    if (!forceRebuild && existing) {
      if (this.options.localPeerId < peerId) {
        await this.sendIceRestartOffer(peerId, existing, reason);
      } else {
        await this.options.send({
          type: "peer_restart_request",
          roomId: this.options.roomId,
          peerId: this.options.localPeerId,
          targetPeerId: peerId,
          reason: `ice_restart:${reason}`,
        });
      }
      this.scheduleRebuild(peerId, reason);
      return;
    }
    const peer = this.options.replacePeer(peerId);
    if (this.options.localPeerId < peerId) {
      await this.sendFreshOffer(peerId, peer, reason);
    } else {
      await this.options.send({
        type: "peer_restart_request",
        roomId: this.options.roomId,
        peerId: this.options.localPeerId,
        targetPeerId: peerId,
        reason: `rebuild:${reason}`,
      });
    }
  }

  private async sendIceRestartOffer(peerId: string, peer: MeshPeerConnection, reason: string) {
    await this.options.applyScreenShare(peer);
    const offer = await peer.createIceRestartOffer();
    await this.options.send({
      type: "peer_offer",
      roomId: this.options.roomId,
      peerId: this.options.localPeerId,
      targetPeerId: peerId,
      sdp: offer,
    });
    void writeRendererLog("webrtc", "info", "ICE restart offer sent", {
      targetPeerId: peerId,
      reason,
    });
  }

  private scheduleRebuild(peerId: string, reason: string): void {
    const existing = this.timers.get(peerId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.timers.delete(peerId);
      if (
        !this.options.readyPeerIds.has(peerId) &&
        this.options.canRecover() &&
        this.options.remotePeerIds.has(peerId)
      ) {
        void this.enqueue(peerId, "rebuild_after_ice_restart", () =>
          this.recover(peerId, `ice_restart_timeout:${reason}`, true),
        ).catch(() => this.schedule(peerId, "peer_rebuild_failed"));
      }
    }, 5_500);
    this.timers.set(peerId, timer);
  }

  private async sendFreshOffer(peerId: string, peer: MeshPeerConnection, reason: string) {
    await this.options.applyScreenShare(peer);
    this.options.notifyScreenShare(peerId);
    const offer = await peer.createOffer();
    await this.options.send({
      type: "peer_offer",
      roomId: this.options.roomId,
      peerId: this.options.localPeerId,
      targetPeerId: peerId,
      sdp: offer,
    });
    void writeRendererLog("webrtc", "info", "Fresh peer media offer sent", {
      targetPeerId: peerId,
      reason,
    });
  }

  private enqueue(peerId: string, name: string, operation: () => Promise<void>): Promise<void> {
    return this.options.operationQueue.enqueue(peerId, name, operation);
  }
}
