import { RemoteControlTrustedState } from "./remote-control-trusted-state";
import {
  RemoteControlSession,
  type NativeInputSink,
  type RemoteControlHostState,
} from "./remote-control-session";
import {
  RemoteControlController,
  sameRemoteIdentity,
  sameControlBinding,
  shareControlBinding,
} from "./remote-control-controller";
import type { AuthenticatedMembership } from "./signaling-membership";
import type {
  RemoteControlNativeCapabilities,
  RemoteControlServiceSnapshot,
  RemoteControlWireMessage,
} from "../../../../packages/shared/src/types/remote-control-service.types";
import type {
  RemoteControlDuration,
  RemoteControlGrant,
  RemoteControlInputEvent,
  RemoteControlLane,
  RemoteControlMemberIdentity,
  RemoteControlRequest,
  RemoteControlResult,
  RemoteControlSnapshot,
} from "../../../../packages/shared/src/types/remote-control.types";
export type {
  HostShareInfo,
  RemoteControlServiceSnapshot,
  RemoteControlWireMessage,
} from "../../../../packages/shared/src/types/remote-control-service.types";

export interface RemoteControlNativeClient extends NativeInputSink {
  prepare(): Promise<RemoteControlNativeCapabilities>;
  activateGrant(lease: { grantId: string; generation: number }): Promise<boolean>;
  dispose(): void;
}
interface Options {
  readHostState: () => RemoteControlHostState;
  readMembership: () => AuthenticatedMembership | undefined;
  createNative: (onSafetyStop: (reason: string) => void) => RemoteControlNativeClient;
  send: (peerId: string, message: RemoteControlWireMessage, lane: RemoteControlLane) => boolean;
  onState?: (snapshot: RemoteControlServiceSnapshot) => void;
  now?: () => number;
  scheduleTick?: (callback: () => void) => () => void;
}
const fail = (reason: string): RemoteControlResult<never> => ({ ok: false, reason });
const ok = <T>(value: T): RemoteControlResult<T> => ({ ok: true, value });
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[\w:.-]{1,160}$/.test(value);

/** Main grant authority. Remote grants only reach the isolated controller-side state. */
export class RemoteControlService {
  private readonly session: RemoteControlSession;
  private readonly trusted: RemoteControlTrustedState;
  private readonly controller: RemoteControlController;
  private readonly now: () => number;
  private readonly stopTick: () => void;
  private readonly incoming = new Map<
    string,
    { request: RemoteControlRequest; geometry: string }
  >();
  private readonly capabilities = new Map<string, RemoteControlMemberIdentity>();
  private readonly rates = new Map<string, { at: number; count: number }>();
  private native?: RemoteControlNativeClient;
  private nativeCapabilities?: RemoteControlNativeCapabilities;
  private approving = false;
  private activating = false;
  private disposed = false;
  private epoch = 0;
  private lastHost?: RemoteControlSnapshot;
  private lastShare = "";
  private lastPublished = "";

  constructor(private readonly options: Options) {
    this.now = options.now ?? (() => performance.now());
    this.trusted = new RemoteControlTrustedState(
      options.readHostState,
      options.readMembership,
      () => this.nativeCapabilities,
    );
    this.controller = new RemoteControlController({
      membership: () => this.trusted.membership(),
      peer: (peer) => this.trusted.peer(peer),
      send: (peer, message, lane) => this.send(peer, message, lane),
      now: this.now,
    });
    this.session = new RemoteControlSession({
      readHostState: () => this.trusted.host(),
      now: this.now,
      scheduleWatchdog: () => () => {},
      sink: {
        execute: (command) => this.native?.execute(command) ?? Promise.resolve(false),
        invalidateAndRelease: (lease) => this.native?.invalidateAndRelease(lease),
      },
    });
    this.stopTick =
      options.scheduleTick?.(() => this.refresh()) ??
      (() => {
        const timer = setInterval(() => this.refresh(), 100);
        timer.unref();
        return () => clearInterval(timer);
      })();
  }
  private send(
    peerId: string,
    message: RemoteControlWireMessage,
    lane: RemoteControlLane = "reliable",
  ): boolean {
    try {
      const peer = this.trusted.peer(peerId);
      return (
        !this.disposed &&
        Boolean(peer && sameRemoteIdentity(peer, this.capabilities.get(peerId)!)) &&
        this.options.send(peerId, message, lane)
      );
    } catch {
      return false;
    }
  }
  sendHostShareInfo(peerId?: string): boolean {
    try {
      const share = this.trusted.shareInfo();
      let sent = true;
      for (const peer of peerId ? [peerId] : this.capabilities.keys())
        sent = this.send(peer, { v: 1, type: "share-info", share }) && sent;
      return sent;
    } catch {
      return false;
    }
  }
  snapshot(): RemoteControlServiceSnapshot {
    return structuredClone({
      host: this.activating ? { phase: "pending", requests: [] } : this.session.snapshot(),
      incomingRequests: [...this.incoming.values()].map((row) => row.request),
      ...this.controller.snapshot(),
      native: this.nativeCapabilities,
    });
  }
  private publish(): void {
    if (this.activating) return;
    let current = this.session.snapshot();
    const previous = this.lastHost;
    if (previous?.grant && (!current.grant || previous.grant.grantId !== current.grant.grantId))
      this.send(previous.grant.binding.controller.peerId, {
        v: 1,
        type: "revoke",
        grantId: previous.grant.grantId,
        generation: previous.grant.generation,
        reason: current.reason ?? "control-ended",
      });
    if (
      current.grant &&
      (current.grant.generation !== previous?.grant?.generation ||
        current.phase !== previous?.phase)
    ) {
      const grant = current.grant;
      const message: RemoteControlWireMessage =
        current.phase === "paused"
          ? { v: 1, type: "pause", grantId: grant.grantId, generation: grant.generation }
          : { v: 1, type: "grant", grant };
      if (!this.send(grant.binding.controller.peerId, message)) {
        this.session.onSafetyEvent("connection-lost");
        current = this.session.snapshot();
      }
    }
    this.lastHost = current;
    const snapshot = this.snapshot(),
      encoded = JSON.stringify(snapshot);
    if (encoded !== this.lastPublished) {
      this.lastPublished = encoded;
      try {
        this.options.onState?.(snapshot);
      } catch {
        /* observers cannot delay cleanup */
      }
    }
  }
  refresh(): void {
    if (this.disposed) return;
    try {
      for (const [peer, identity] of [...this.capabilities])
        if (!sameRemoteIdentity(this.trusted.peer(peer)!, identity)) this.onPeerDisconnected(peer);
      const share = this.trusted.shareInfo(),
        signature = JSON.stringify(share);
      if (signature !== this.lastShare) {
        this.epoch++;
        this.lastShare = signature;
        this.sendHostShareInfo();
      }
      for (const [requestId, row] of this.incoming) {
        const peer = this.trusted.peer(row.request.binding.controller.peerId);
        if (
          !peer ||
          !share?.requestable ||
          !sameControlBinding(row.request.binding, shareControlBinding(share, peer)) ||
          row.request.expiresAtMs <= this.now()
        ) {
          this.incoming.delete(requestId);
          this.send(row.request.binding.controller.peerId, {
            v: 1,
            type: "deny",
            requestId,
            reason: "request-no-longer-valid",
          });
        }
      }
      this.session.tick();
      this.controller.refresh();
    } catch {
      this.epoch++;
      this.incoming.clear();
      this.session.onSafetyEvent("room-left");
      this.controller.stopAll("membership-unavailable");
    }
    this.publish();
  }
  onCapability(peerId: string, available: boolean): void {
    const peer = this.trusted.peer(peerId);
    if (!peer) return;
    if (!available) {
      this.onPeerDisconnected(peerId);
      return;
    }
    this.capabilities.set(peerId, structuredClone(peer));
    this.sendHostShareInfo(peerId);
    this.publish();
  }
  onPeerDisconnected(peerId: string): void {
    this.epoch++;
    this.capabilities.delete(peerId);
    this.session.onPeerDisconnected(peerId);
    this.controller.disconnected(peerId);
    this.rates.delete(peerId);
    for (const [id, row] of this.incoming)
      if (row.request.binding.controller.peerId === peerId) this.incoming.delete(id);
    this.publish();
  }
  onLocalSafetyEvent(reason: Parameters<RemoteControlSession["onSafetyEvent"]>[0]): void {
    this.epoch++;
    this.incoming.clear();
    this.session.onSafetyEvent(reason);
    this.controller.stopAll(reason);
    this.publish();
  }
  private discardNative(): void {
    const native = this.native;
    this.native = undefined;
    this.nativeCapabilities = undefined;
    native?.dispose();
  }
  private nativeStopped(native: RemoteControlNativeClient): void {
    if (this.native !== native) return;
    this.nativeCapabilities = undefined;
    this.onLocalSafetyEvent("native-worker-failed");
    this.discardNative();
  }
  async approveFromLocalUser(
    requestId: string,
    duration: RemoteControlDuration,
  ): Promise<RemoteControlResult<RemoteControlGrant>> {
    this.refresh();
    const pending = this.incoming.get(requestId);
    if (!pending || this.approving || this.disposed) return fail("request-not-pending");
    this.approving = true;
    const epoch = this.epoch;
    let timeout: NodeJS.Timeout | undefined;
    try {
      const native = this.native ?? this.options.createNative(() => this.nativeStopped(native));
      this.native = native;
      const capability = await Promise.race([
        native.prepare(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(Error("native-prepare-timeout")), 1500);
        }),
      ]);
      if (
        this.disposed ||
        epoch !== this.epoch ||
        this.incoming.get(requestId) !== pending ||
        this.native !== native
      )
        return fail("approval-cancelled");
      if (!capability.supported || !capability.emergencyStopReady || capability.dryRun) {
        this.denyFromLocalUser(requestId, "native-input-read-only");
        return fail("native-input-read-only");
      }
      const peer = this.trusted.peer(pending.request.binding.controller.peerId),
        share = this.trusted.shareInfo();
      if (
        !peer ||
        !share?.requestable ||
        !sameControlBinding(pending.request.binding, shareControlBinding(share, peer)) ||
        pending.geometry !== JSON.stringify(this.options.readHostState().share)
      )
        return fail("request-binding-changed");
      this.nativeCapabilities = capability;
      const internal = this.session.request(peer);
      if (!internal.ok) return internal;
      this.activating = true;
      const approved = this.session.approveFromLocalUser(internal.value.requestId, duration);
      if (
        approved.ok &&
        (!(await native.activateGrant(approved.value)) ||
          epoch !== this.epoch ||
          this.session.snapshot().grant?.grantId !== approved.value.grantId)
      ) {
        this.session.onSafetyEvent("native-worker-failed");
        return fail("native-input-unavailable");
      }
      this.activating = false;
      if (approved.ok) {
        for (const [id, row] of this.incoming)
          if (id !== requestId)
            this.send(row.request.binding.controller.peerId, {
              v: 1,
              type: "deny",
              requestId: id,
              reason: "controller-busy",
            });
        this.incoming.clear();
      } else this.session.denyFromLocalUser(internal.value.requestId);
      this.publish();
      if (approved.ok && this.session.snapshot().grant?.grantId !== approved.value.grantId)
        return fail("grant-delivery-failed");
      return approved;
    } catch {
      this.denyFromLocalUser(requestId, "native-input-unavailable");
      return fail("native-input-unavailable");
    } finally {
      this.activating = false;
      clearTimeout(timeout);
      this.approving = false;
      if (!this.session.snapshot().grant) this.discardNative();
      this.publish();
    }
  }
  denyFromLocalUser(requestId: string, reason = "local-denied"): RemoteControlResult {
    const row = this.incoming.get(requestId);
    if (!row) return fail("request-not-pending");
    this.incoming.delete(requestId);
    this.send(row.request.binding.controller.peerId, { v: 1, type: "deny", requestId, reason });
    this.publish();
    return ok(undefined);
  }
  pauseFromLocalUser(): RemoteControlResult {
    const result = this.session.pauseFromLocalUser();
    this.publish();
    return result;
  }
  async resumeFromLocalUser(): Promise<RemoteControlResult<RemoteControlGrant>> {
    this.activating = true;
    const result = this.session.resumeFromLocalUser();
    try {
      if (result.ok && !(await this.native?.activateGrant(result.value))) {
        this.session.onSafetyEvent("native-worker-failed");
        return fail("native-input-unavailable");
      }
      if (result.ok && this.session.snapshot().grant?.generation !== result.value.generation)
        return fail("approval-cancelled");
      return result;
    } catch {
      this.session.onSafetyEvent("native-worker-failed");
      return fail("native-input-unavailable");
    } finally {
      this.activating = false;
      this.publish();
    }
  }
  revokeFromLocalUser(): void {
    this.session.revokeFromLocalUser();
    this.publish();
  }
  emergencyStop(): void {
    this.onLocalSafetyEvent("local-input");
  }
  requestControl(peerId: string): RemoteControlResult<RemoteControlRequest> {
    try {
      const result = this.controller.request(peerId);
      this.publish();
      return result;
    } catch {
      return fail("membership-unavailable");
    }
  }
  cancelRequest(peerId: string): void {
    this.controller.cancel(peerId);
    this.publish();
  }
  stopControlling(peerId: string): void {
    this.controller.drop(peerId, "controller-stopped");
    this.publish();
  }
  observeRemoteFrame(peerId: string, shareSessionId: string): void {
    this.controller.observeFrame(peerId, shareSessionId);
  }
  sendInput(
    peerId: string,
    event: RemoteControlInputEvent,
    lane: RemoteControlLane,
  ): RemoteControlResult {
    const result = this.controller.sendInput(peerId, event, lane);
    this.publish();
    return result;
  }

  /** Only authenticated transport supplies peerId/lane. Every payload binding remains untrusted. */
  async receive(
    peerId: string,
    message: RemoteControlWireMessage,
    lane: RemoteControlLane = "reliable",
  ): Promise<RemoteControlResult> {
    const peer = this.trusted.peer(peerId);
    if (!peer || !sameRemoteIdentity(peer, this.capabilities.get(peerId)!) || this.disposed)
      return fail("unauthenticated-peer");
    try {
      if (!message || message.v !== 1 || Buffer.byteLength(JSON.stringify(message), "utf8") > 8192)
        return fail("invalid-message");
      if (message.type !== "input" && lane !== "reliable") return fail("invalid-lane");
      if (message.type !== "input") {
        const rate = this.rates.get(peerId) ?? { at: this.now(), count: 0 };
        if (this.now() - rate.at >= 1000) {
          rate.at = this.now();
          rate.count = 0;
        }
        this.rates.set(peerId, rate);
        if (++rate.count > 40) return fail("control-rate-limit");
      }
      switch (message.type) {
        case "request-control":
        case "request": {
          const share = this.trusted.shareInfo();
          const requestId =
            message.type === "request-control" ? message.requestId : message.request?.requestId;
          const shareSessionId =
            message.type === "request-control"
              ? message.shareSessionId
              : message.request?.binding?.shareSessionId;
          if (
            !share?.requestable ||
            !id(requestId) ||
            shareSessionId !== share.shareSessionId ||
            this.incoming.size >= 4 ||
            this.incoming.has(requestId) ||
            this.session.snapshot().grant
          )
            return fail("share-not-requestable");
          if (
            [...this.incoming.values()].some(
              (row) => row.request.binding.controller.peerId === peerId,
            )
          )
            return fail("request-already-pending");
          this.incoming.set(requestId, {
            request: {
              requestId,
              binding: shareControlBinding(share, peer),
              requestedAtMs: this.now(),
              expiresAtMs: this.now() + 30000,
            },
            geometry: JSON.stringify(this.options.readHostState().share),
          });
          break;
        }
        case "cancel": {
          const row = this.incoming.get(message.requestId);
          if (row?.request.binding.controller.peerId === peerId)
            this.incoming.delete(message.requestId);
          break;
        }
        case "input": {
          const result = await this.session.acceptInput(peer, message.input, lane);
          this.publish();
          return result;
        }
        case "revoke": {
          const grant = this.session.snapshot().grant;
          if (grant?.grantId === message.grantId && grant.generation === message.generation)
            this.session.stopFromController(peer, message.grantId);
          this.controller.receive(peer, message);
          break;
        }
        default: {
          const handled = this.controller.receive(peer, message);
          if (!handled) return fail("unknown-message");
          if (!handled.ok) return handled;
        }
      }
      this.publish();
      return ok(undefined);
    } catch {
      return fail("invalid-message");
    }
  }
  dispose(): void {
    this.onLocalSafetyEvent("owner-destroyed");
    this.disposed = true;
    this.stopTick();
    this.session.dispose();
    this.discardNative();
    this.controller.dispose();
    this.capabilities.clear();
    this.rates.clear();
  }
}
