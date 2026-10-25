import { randomUUID } from "node:crypto";
import type {
  RemoteControlBinding,
  RemoteControlDuration,
  RemoteControlGrant,
  RemoteControlInputEnvelope,
  RemoteControlLane,
  RemoteControlMemberIdentity,
  RemoteControlMouseButton,
  RemoteControlNativeCommand,
  RemoteControlRequest,
  RemoteControlResult,
  RemoteControlShareGeometry,
  RemoteControlSnapshot,
} from "../../../../packages/shared/src/types/remote-control.types";

import {
  finite,
  validRect,
  containsRect,
  sameRect,
  toNativeRemoteControlEvent,
} from "./remote-control-input";
export { normalizeRemotePointer } from "./remote-control-input";

export interface RemoteControlHostState {
  roomId: string;
  host: RemoteControlMemberIdentity;
  members: RemoteControlMemberIdentity[];
  roomActive: boolean;
  connected: boolean;
  locked: boolean;
  permissionGranted: boolean;
  inputSupported: boolean;
  emergencyStopReady: boolean;
  lastVideoFrameAtMs: number;
  share?: RemoteControlShareGeometry;
}

export interface NativeInputSink {
  /** True means actual OS execution succeeded; never an optimistic queue acknowledgement.
   * The native worker must reject invalidated generations, enforce its own parent/lease
   * watchdog, bound queues, and never retry a non-idempotent event automatically. */
  execute(command: RemoteControlNativeCommand): Promise<boolean>;
  /** Synchronously invalidate this generation before returning, including queued commands.
   * Release ONLY remotely owned inputs. Native release/watchdog runs independently of
   * renderer/network and of any blocked AI/process queue. No remote ACK is involved. */
  invalidateAndRelease(lease: {
    grantId: string;
    generation: number;
    keys: string[];
    buttons: RemoteControlMouseButton[];
    reason: string;
  }): void;
}

interface Options {
  /** Main-owned capture metadata and authenticated membership, never renderer assertions. */
  readHostState: () => RemoteControlHostState;
  sink: NativeInputSink;
  now?: () => number;
  scheduleWatchdog?: (callback: () => void) => () => void;
}
const fail = (reason: string): RemoteControlResult<never> => ({ ok: false, reason });
const success = <T>(value: T): RemoteControlResult<T> => ({ ok: true, value });
const sameMember = (a: RemoteControlMemberIdentity, b: RemoteControlMemberIdentity): boolean =>
  a?.peerId === b?.peerId &&
  a?.deviceId === b?.deviceId &&
  a?.memberSessionId === b?.memberSessionId &&
  a?.memberGeneration === b?.memberGeneration;
const sameBinding = (a: RemoteControlBinding, b: RemoteControlBinding): boolean =>
  Boolean(
    a &&
    b &&
    a.roomId === b.roomId &&
    a.shareSessionId === b.shareSessionId &&
    a.captureHandle === b.captureHandle &&
    a.displayId === b.displayId &&
    a.geometryVersion === b.geometryVersion &&
    sameMember(a.target, b.target) &&
    sameMember(a.controller, b.controller),
  );
/** Main-only grant authority. Never deserialize a remote "approved" state into this object. */
export class RemoteControlSession {
  private readonly now: () => number;
  private readonly stopWatchdog: () => void;
  private readonly requests = new Map<string, RemoteControlRequest>();
  private state: RemoteControlSnapshot = { phase: "idle", requests: [] };
  private grant?: RemoteControlGrant;
  private share?: RemoteControlShareGeometry;
  private generation = 0;
  private readonly sequences: Record<RemoteControlLane, number> = { reliable: 0, pointer: 0 };
  private readonly keys = new Set<string>();
  private readonly buttons = new Set<RemoteControlMouseButton>();
  private readonly heldSequences = new Map<string, number>();
  private inFlight = 0;
  private rateWindowAt = 0;
  private rateCount = 0;
  private disposed = false;
  private nativeFault = false;

  constructor(private readonly options: Options) {
    this.now = options.now ?? (() => performance.now());
    this.stopWatchdog =
      options.scheduleWatchdog?.(() => this.tick()) ??
      (() => {
        const timer = setInterval(() => this.tick(), 100);
        timer.unref();
        return () => clearInterval(timer);
      })();
  }

  snapshot(): RemoteControlSnapshot {
    return structuredClone({
      ...this.state,
      requests: [...this.requests.values()],
      grant: this.grant,
    });
  }

  private hostState(): RemoteControlHostState | undefined {
    try {
      return this.options.readHostState();
    } catch {
      this.revoke("host-state-unavailable");
      return undefined;
    }
  }

  private binding(
    host: RemoteControlHostState,
    controller: RemoteControlMemberIdentity,
  ): RemoteControlBinding {
    const share = host.share!;
    return structuredClone({
      roomId: host.roomId,
      shareSessionId: share.shareSessionId,
      captureHandle: share.captureHandle,
      displayId: share.displayId,
      geometryVersion: share.geometryVersion,
      target: host.host,
      controller,
    });
  }

  private ready(host: RemoteControlHostState): string | undefined {
    if (this.disposed || this.nativeFault) return "input-unavailable";
    if (!host.roomActive || !host.connected) return "room-disconnected";
    if (host.locked || !host.permissionGranted || !host.inputSupported || !host.emergencyStopReady)
      return "local-input-unavailable";
    const share = host.share;
    if (!share || share.kind !== "screen") return "whole-display-share-required";
    if (
      !share.captureHandle ||
      !share.shareSessionId ||
      !share.displayId ||
      !host.roomId ||
      !Number.isSafeInteger(share.geometryVersion) ||
      share.geometryVersion < 1 ||
      !validRect(share.displayBoundsDip) ||
      !validRect(share.displayBoundsPhysical) ||
      !validRect(share.virtualDesktopBoundsPhysical) ||
      !containsRect(share.virtualDesktopBoundsPhysical, share.displayBoundsPhysical)
    )
      return "invalid-capture-binding";
  }

  request(sender: RemoteControlMemberIdentity): RemoteControlResult<RemoteControlRequest> {
    this.tick();
    const host = this.hostState();
    if (!host) return fail("host-state-unavailable");
    const reason = this.ready(host);
    if (reason) return fail(reason);
    if (!host.members.some((member) => sameMember(member, sender)) || sameMember(host.host, sender))
      return fail("not-current-member");
    if (this.grant) return fail("controller-busy");
    if (
      [...this.requests.values()].some((request) => sameMember(request.binding.controller, sender))
    )
      return fail("request-already-pending");
    if (this.requests.size >= 4) return fail("request-limit");
    const request: RemoteControlRequest = {
      requestId: randomUUID(),
      binding: this.binding(host, sender),
      requestedAtMs: this.now(),
      expiresAtMs: this.now() + 30_000,
    };
    this.requests.set(request.requestId, request);
    this.state = { phase: "pending", requests: [] };
    return success(structuredClone(request));
  }

  cancel(sender: RemoteControlMemberIdentity, requestId: string): RemoteControlResult {
    const request = this.requests.get(requestId);
    if (!request || !sameMember(request.binding.controller, sender))
      return fail("request-not-owned");
    this.requests.delete(requestId);
    if (!this.requests.size) this.state.phase = "idle";
    return success(undefined);
  }

  denyFromLocalUser(requestId: string): RemoteControlResult {
    if (!this.requests.delete(requestId)) return fail("request-not-pending");
    this.state.phase = this.requests.size ? "pending" : "denied";
    return success(undefined);
  }

  /** IPC must authenticate the local main-window sender before invoking this method. */
  approveFromLocalUser(
    requestId: string,
    duration: RemoteControlDuration,
  ): RemoteControlResult<RemoteControlGrant> {
    this.tick();
    const request = this.requests.get(requestId),
      host = this.hostState();
    if (!host) return fail("host-state-unavailable");
    const reason = this.ready(host);
    if (reason) return fail(reason);
    if (this.grant) return fail("controller-busy");
    if (!request || request.expiresAtMs <= this.now()) return fail("request-not-pending");
    if (duration !== "ten-minutes" && duration !== "share-lifetime")
      return fail("invalid-duration");
    if (this.videoStale(host)) return fail("video-stale");
    if (
      !host.members.some((member) => sameMember(member, request.binding.controller)) ||
      !sameBinding(request.binding, this.binding(host, request.binding.controller))
    )
      return fail("request-binding-changed");
    this.grant = {
      grantId: randomUUID(),
      generation: ++this.generation,
      binding: structuredClone(request.binding),
      permissions: ["pointer", "keyboard", "text"],
      issuedAtMs: this.now(),
      expiresAtMs: duration === "ten-minutes" ? this.now() + 600_000 : null,
    };
    this.share = structuredClone(host.share);
    this.requests.clear();
    this.sequences.reliable = this.sequences.pointer = this.rateCount = 0;
    this.state = { phase: "active", requests: [] };
    return success(structuredClone(this.grant));
  }

  private release(reason: string): void {
    const grant = this.grant;
    if (!grant) return;
    const owned = {
      grantId: grant.grantId,
      generation: grant.generation,
      keys: [...this.keys],
      buttons: [...this.buttons],
      reason,
    };
    this.keys.clear();
    this.buttons.clear();
    this.heldSequences.clear();
    ++this.generation;
    try {
      this.options.sink.invalidateAndRelease(owned);
    } catch {
      this.nativeFault = true;
    }
  }

  private revoke(reason: string): void {
    this.state = {
      phase: reason === "grant-expired" ? "expired" : "revoked",
      requests: [],
      reason,
    };
    this.requests.clear();
    this.release(reason);
    this.grant = undefined;
    this.share = undefined;
  }

  revokeFromLocalUser(): void {
    this.revoke("local-revoke");
  }
  stopFromController(sender: RemoteControlMemberIdentity, grantId: string): RemoteControlResult {
    if (
      !this.grant ||
      this.grant.grantId !== grantId ||
      !sameMember(sender, this.grant.binding.controller)
    )
      return fail("grant-not-owned");
    this.revoke("controller-stopped");
    return success(undefined);
  }
  emergencyStop(): void {
    this.revoke("local-emergency-stop");
  }
  onSafetyEvent(
    reason:
      | "room-left"
      | "share-stopped"
      | "screen-locked"
      | "permission-revoked"
      | "owner-destroyed"
      | "app-suspend"
      | "local-input"
      | "connection-lost"
      | "native-worker-failed",
  ): void {
    this.revoke(reason);
  }
  onPeerDisconnected(peerId: string): void {
    for (const [id, request] of this.requests)
      if (request.binding.controller.peerId === peerId) this.requests.delete(id);
    if (
      this.grant &&
      [this.grant.binding.controller.peerId, this.grant.binding.target.peerId].includes(peerId)
    )
      this.revoke("peer-disconnected");
  }
  pauseFromLocalUser(): RemoteControlResult {
    if (!this.grant || this.state.phase !== "active") return fail("not-active");
    this.state.phase = "paused";
    this.release("local-pause");
    return success(undefined);
  }
  resumeFromLocalUser(): RemoteControlResult<RemoteControlGrant> {
    this.tick();
    if (!this.grant || this.state.phase !== "paused") return fail("not-paused");
    const host = this.hostState();
    if (!host) return fail("host-state-unavailable");
    if (this.videoStale(host)) return fail("video-stale");
    this.grant.generation = ++this.generation;
    this.state.phase = "active";
    this.state.reason = undefined;
    return success(structuredClone(this.grant));
  }
  private videoStale(host: RemoteControlHostState): boolean {
    return (
      !finite(host.lastVideoFrameAtMs) ||
      this.now() - host.lastVideoFrameAtMs > 1_500 ||
      host.lastVideoFrameAtMs > this.now() + 50
    );
  }
  tick(): void {
    const now = this.now(),
      host = this.hostState();
    if (!host) return;
    for (const [id, request] of this.requests)
      if (request.expiresAtMs <= now) this.requests.delete(id);
    if (!this.grant) {
      if (this.state.phase === "pending" && !this.requests.size) this.state.phase = "idle";
      return;
    }
    const grant = this.grant,
      share = host.share,
      original = this.share;
    const reason = this.ready(host);
    if (reason) return this.revoke(reason);
    if (grant.expiresAtMs !== null && grant.expiresAtMs <= now) return this.revoke("grant-expired");
    if (
      !host.members.some((member) => sameMember(member, grant.binding.controller)) ||
      !sameBinding(grant.binding, this.binding(host, grant.binding.controller)) ||
      !original ||
      !share ||
      !sameRect(original.displayBoundsDip, share.displayBoundsDip) ||
      !sameRect(original.displayBoundsPhysical, share.displayBoundsPhysical) ||
      !sameRect(original.virtualDesktopBoundsPhysical, share.virtualDesktopBoundsPhysical)
    )
      return this.revoke("grant-binding-changed");
    if (this.state.phase === "active" && this.videoStale(host)) {
      this.state.phase = "paused";
      this.state.reason = "video-stale";
      this.release("video-stale");
    }
  }

  /** sender/lane must come from the authenticated DataChannel, not the envelope. */
  async acceptInput(
    sender: RemoteControlMemberIdentity,
    packet: RemoteControlInputEnvelope,
    lane: RemoteControlLane,
  ): Promise<RemoteControlResult> {
    this.tick();
    const grant = this.grant;
    if (!grant || this.state.phase !== "active") return fail("not-active");
    if (lane !== "pointer" && lane !== "reliable") return fail("invalid-lane");
    try {
      if (Buffer.byteLength(JSON.stringify(packet), "utf8") > 4096) return fail("packet-too-large");
      if (
        !sameMember(sender, grant.binding.controller) ||
        packet.grantId !== grant.grantId ||
        packet.generation !== grant.generation ||
        !sameBinding(packet.binding, grant.binding)
      )
        return fail("unauthorized-binding");
      if (!Number.isSafeInteger(packet.sequence) || packet.sequence <= this.sequences[lane])
        return fail("replayed-sequence");
      const age = this.now() - packet.hostTimeMs;
      if (!finite(packet.hostTimeMs) || age > 250 || age < -50) {
        this.pauseFromLocalUser();
        return fail("stale-input");
      }
      if ((packet.event.kind === "pointer") !== (lane === "pointer"))
        return fail("event-lane-mismatch");
      const event = toNativeRemoteControlEvent(packet.event, this.share!);
      if (!event) return fail("invalid-input");
      if (this.now() - this.rateWindowAt >= 1_000) {
        this.rateWindowAt = this.now();
        this.rateCount = 0;
      }
      if (++this.rateCount > 240 || this.inFlight >= 16) {
        this.pauseFromLocalUser();
        return fail("input-backpressure");
      }
      let heldId: string | undefined;
      const held =
        event.kind === "key" ? this.keys : event.kind === "button" ? this.buttons : undefined;
      if (held && (event.kind === "key" || event.kind === "button")) {
        const key = event.kind === "key" ? event.code : event.button;
        if (!event.pressed && !held.has(key as RemoteControlMouseButton))
          return fail("input-not-owned");
        if (event.pressed && this.keys.size >= 32 && event.kind === "key" && !this.keys.has(key))
          return fail("held-key-limit");
        heldId = `${event.kind}:${key}`;
        this.heldSequences.set(heldId, packet.sequence);
        if (event.pressed) (held as Set<string>).add(key);
      }
      this.sequences[lane] = packet.sequence;
      const generation = grant.generation;
      this.inFlight++;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const applied = await Promise.race([
          this.options.sink.execute({ grantId: grant.grantId, generation, event }),
          new Promise<false>((resolve) => {
            timeout = setTimeout(() => resolve(false), 250);
          }),
        ]);
        if (
          this.grant !== grant ||
          generation !== this.grant.generation ||
          this.state.phase !== "active"
        )
          return fail("grant-ended");
        if (!applied) {
          this.revoke("native-input-failed");
          return fail("native-input-failed");
        }
        if (
          held &&
          heldId &&
          this.heldSequences.get(heldId) === packet.sequence &&
          (event.kind === "key" || event.kind === "button") &&
          !event.pressed
        ) {
          (held as Set<string>).delete(event.kind === "key" ? event.code : event.button);
          this.heldSequences.delete(heldId);
        }
        return success(undefined);
      } catch {
        if (this.grant === grant && generation === grant.generation)
          this.revoke("native-input-failed");
        return fail("native-input-failed");
      } finally {
        clearTimeout(timeout);
        this.inFlight--;
      }
    } catch {
      return fail("malformed-input");
    }
  }

  dispose(): void {
    this.revoke("owner-destroyed");
    this.disposed = true;
    this.stopWatchdog();
  }
}
