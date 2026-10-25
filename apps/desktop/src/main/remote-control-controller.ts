import { randomUUID } from "node:crypto";
import type { AuthenticatedMembership } from "./signaling-membership";
import type {
  HostShareInfo,
  RemoteControlControllerSnapshot,
  RemoteControlWireMessage,
} from "../../../../packages/shared/src/types/remote-control-service.types";
import type {
  RemoteControlBinding,
  RemoteControlGrant,
  RemoteControlInputEvent,
  RemoteControlLane,
  RemoteControlMemberIdentity,
  RemoteControlRequest,
  RemoteControlResult,
} from "../../../../packages/shared/src/types/remote-control.types";

export const sameRemoteIdentity = (
  a: RemoteControlMemberIdentity,
  b: RemoteControlMemberIdentity,
): boolean =>
  Boolean(
    a &&
    b &&
    a.peerId === b.peerId &&
    a.deviceId === b.deviceId &&
    a.memberSessionId === b.memberSessionId &&
    a.memberGeneration === b.memberGeneration,
  );
export const shareControlBinding = (
  share: HostShareInfo,
  controller: RemoteControlMemberIdentity,
): RemoteControlBinding => ({
  roomId: share.roomId,
  shareSessionId: share.shareSessionId,
  captureHandle: share.captureHandle,
  displayId: share.displayId,
  geometryVersion: share.geometryVersion,
  target: structuredClone(share.owner),
  controller: structuredClone(controller),
});
export const sameControlBinding = (a: RemoteControlBinding, b: RemoteControlBinding): boolean =>
  Boolean(
    a &&
    b &&
    a.roomId === b.roomId &&
    a.shareSessionId === b.shareSessionId &&
    a.captureHandle === b.captureHandle &&
    a.displayId === b.displayId &&
    a.geometryVersion === b.geometryVersion &&
    sameRemoteIdentity(a.target, b.target) &&
    sameRemoteIdentity(a.controller, b.controller),
  );
const fail = (reason: string): RemoteControlResult<never> => ({ ok: false, reason });
const ok = <T>(value: T): RemoteControlResult<T> => ({ ok: true, value });
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[\w:.-]{1,160}$/.test(value);
interface Options {
  membership: () => AuthenticatedMembership;
  peer: (peerId: string) => RemoteControlMemberIdentity | undefined;
  send: (peerId: string, message: RemoteControlWireMessage, lane?: RemoteControlLane) => boolean;
  now: () => number;
}
interface Controlling {
  grant: RemoteControlGrant;
  paused: boolean;
  reliable: number;
  pointer: number;
  received: number;
  hasSentInput: boolean;
}
/** Controller-side state cannot grant permission to this computer or access a native sink. */
export class RemoteControlController {
  private readonly shares = new Map<string, HostShareInfo>();
  private readonly outgoing = new Map<string, RemoteControlRequest>();
  private readonly grants = new Map<string, Controlling>();
  private readonly frames = new Map<string, number>();
  private readonly clocks = new Map<string, { offset: number; received: number }>();
  private readonly clockPending = new Map<string, { nonce: string; sent: number }>();
  constructor(private readonly options: Options) {}
  snapshot(): RemoteControlControllerSnapshot {
    return structuredClone({
      remoteShares: Object.fromEntries(this.shares),
      outgoingRequests: Object.fromEntries(this.outgoing),
      remoteGrants: Object.fromEntries(
        [...this.grants].map(([peer, { grant, paused }]) => [peer, { grant, paused }]),
      ),
    });
  }
  drop(peerId: string, reason: string): void {
    const grant = this.grants.get(peerId)?.grant;
    if (grant)
      this.options.send(peerId, {
        v: 1,
        type: "revoke",
        grantId: grant.grantId,
        generation: grant.generation,
        reason,
      });
    this.grants.delete(peerId);
    this.frames.delete(peerId);
  }
  stopAll(reason: string): void {
    for (const peer of [...this.grants.keys()]) this.drop(peer, reason);
    this.outgoing.clear();
  }
  disconnected(peerId: string): void {
    this.shares.delete(peerId);
    this.outgoing.delete(peerId);
    this.grants.delete(peerId);
    this.clocks.delete(peerId);
    this.clockPending.delete(peerId);
    this.frames.delete(peerId);
  }
  refresh(): void {
    const now = this.options.now(),
      membership = this.options.membership();
    for (const [peer, request] of this.outgoing)
      if (request.expiresAtMs <= now) {
        this.cancel(peer);
      }
    for (const [peer, sample] of this.clockPending)
      if (now - sample.sent > 2000) this.clockPending.delete(peer);
    for (const [peer, row] of this.grants) {
      const member = this.options.peer(peer),
        share = this.shares.get(peer),
        clock = this.clocks.get(peer),
        frame = this.frames.get(peer);
      if (
        !member ||
        !share ||
        !sameRemoteIdentity(member, row.grant.binding.target) ||
        !sameRemoteIdentity(membership.host, row.grant.binding.controller) ||
        membership.roomId !== row.grant.binding.roomId
      ) {
        this.drop(peer, "member-changed");
        continue;
      }
      if (now - row.received > 1500 && (frame === undefined || now - frame > 1500)) {
        this.drop(peer, "video-stale");
        continue;
      }
      if (clock && row.grant.expiresAtMs !== null && now + clock.offset >= row.grant.expiresAtMs) {
        this.drop(peer, "grant-expired");
        continue;
      }
      if (clock && now - clock.received > 5000) {
        this.drop(peer, "clock-stale");
        continue;
      }
      if (!clock || now - clock.received > 2000) this.requestClock(peer);
    }
  }
  request(peerId: string): RemoteControlResult<RemoteControlRequest> {
    const share = this.shares.get(peerId),
      peer = this.options.peer(peerId);
    if (
      !share?.requestable ||
      share.kind !== "screen" ||
      !peer ||
      !sameRemoteIdentity(peer, share.owner) ||
      this.outgoing.has(peerId) ||
      this.grants.has(peerId)
    )
      return fail("share-not-requestable");
    const request = {
      requestId: randomUUID(),
      binding: shareControlBinding(share, this.options.membership().host),
      requestedAtMs: this.options.now(),
      expiresAtMs: this.options.now() + 30000,
    };
    this.outgoing.set(peerId, request);
    if (
      !this.options.send(peerId, {
        v: 1,
        type: "request-control",
        requestId: request.requestId,
        shareSessionId: share.shareSessionId,
      })
    ) {
      this.outgoing.delete(peerId);
      return fail("transport-unavailable");
    }
    return ok(structuredClone(request));
  }
  cancel(peerId: string): void {
    const request = this.outgoing.get(peerId);
    if (request) this.options.send(peerId, { v: 1, type: "cancel", requestId: request.requestId });
    this.outgoing.delete(peerId);
  }
  observeFrame(peerId: string, shareSessionId: string): void {
    if (this.shares.get(peerId)?.shareSessionId === shareSessionId && this.options.peer(peerId))
      this.frames.set(peerId, this.options.now());
  }
  private requestClock(peerId: string): void {
    if (!this.options.peer(peerId) || this.clockPending.has(peerId)) return;
    const sample = { nonce: randomUUID(), sent: this.options.now() };
    this.clockPending.set(peerId, sample);
    if (
      !this.options.send(peerId, {
        v: 1,
        type: "clock-request",
        nonce: sample.nonce,
        controllerTimeMs: sample.sent,
      })
    )
      this.clockPending.delete(peerId);
  }
  sendInput(
    peerId: string,
    event: RemoteControlInputEvent,
    lane: RemoteControlLane,
  ): RemoteControlResult {
    const row = this.grants.get(peerId),
      clock = this.clocks.get(peerId),
      frame = this.frames.get(peerId),
      now = this.options.now();
    if (row?.paused) return fail("control-paused");
    if (
      (lane !== "pointer" && lane !== "reliable") ||
      (event?.kind === "pointer") !== (lane === "pointer")
    )
      return fail("invalid-lane");
    if (
      !row ||
      row.paused ||
      !clock ||
      now - clock.received > 5000 ||
      frame === undefined ||
      now - frame > 1500 ||
      !this.options.peer(peerId)
    ) {
      if (row?.hasSentInput) this.drop(peerId, "control-not-fresh");
      this.requestClock(peerId);
      return fail("control-not-fresh");
    }
    if (row.grant.expiresAtMs !== null && now + clock.offset >= row.grant.expiresAtMs) {
      this.drop(peerId, "grant-expired");
      return fail("grant-expired");
    }
    const input = {
      grantId: row.grant.grantId,
      generation: row.grant.generation,
      binding: row.grant.binding,
      sequence: ++row[lane],
      hostTimeMs: now + clock.offset,
      event,
    };
    if (!this.options.send(peerId, { v: 1, type: "input", input }, lane)) {
      this.drop(peerId, "transport-unavailable");
      return fail("transport-unavailable");
    }
    row.hasSentInput = true;
    return ok(undefined);
  }
  receive(
    peer: RemoteControlMemberIdentity,
    message: RemoteControlWireMessage,
  ): RemoteControlResult | undefined {
    const peerId = peer.peerId,
      now = this.options.now();
    switch (message.type) {
      case "revoke": {
        const row = this.grants.get(peerId);
        if (row?.grant.grantId === message.grantId && row.grant.generation === message.generation)
          this.grants.delete(peerId);
        break;
      }
      case "pause": {
        const row = this.grants.get(peerId);
        if (row?.grant.grantId === message.grantId && row.grant.generation === message.generation)
          row.paused = true;
        break;
      }
      case "deny": {
        if (this.outgoing.get(peerId)?.requestId === message.requestId)
          this.outgoing.delete(peerId);
        break;
      }
      case "share-info": {
        const share = message.share;
        if (!share) {
          this.shares.delete(peerId);
          this.outgoing.delete(peerId);
          this.drop(peerId, "share-ended");
          break;
        }
        if (
          share.roomId !== this.options.membership().roomId ||
          !sameRemoteIdentity(share.owner, peer) ||
          !id(share.shareSessionId) ||
          !id(share.captureHandle) ||
          !id(share.displayId) ||
          !Number.isSafeInteger(share.geometryVersion) ||
          share.geometryVersion < 1 ||
          !Number.isFinite(share.width) ||
          !Number.isFinite(share.height) ||
          share.width < 1 ||
          share.height < 1 ||
          share.width > 32768 ||
          share.height > 32768 ||
          !["screen", "window"].includes(share.kind) ||
          typeof share.requestable !== "boolean"
        )
          return fail("invalid-share-info");
        const previous = this.shares.get(peerId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(share)) {
          this.outgoing.delete(peerId);
          this.drop(peerId, "share-changed");
        }
        this.shares.set(peerId, structuredClone(share));
        this.requestClock(peerId);
        break;
      }
      case "grant": {
        const share = this.shares.get(peerId),
          grant = message.grant,
          row = this.grants.get(peerId),
          request = this.outgoing.get(peerId);
        if (
          !share ||
          share.kind !== "screen" ||
          !grant ||
          !id(grant.grantId) ||
          !Number.isSafeInteger(grant.generation) ||
          grant.generation < 1 ||
          !Number.isFinite(grant.issuedAtMs) ||
          grant.issuedAtMs < 0 ||
          !(
            grant.expiresAtMs === null ||
            (Number.isFinite(grant.expiresAtMs) && grant.expiresAtMs > grant.issuedAtMs)
          ) ||
          JSON.stringify(grant.permissions) !== JSON.stringify(["pointer", "keyboard", "text"]) ||
          !sameControlBinding(
            grant.binding,
            shareControlBinding(share, this.options.membership().host),
          ) ||
          (!(row?.grant.grantId === grant.grantId && grant.generation > row.grant.generation) &&
            !request)
        )
          return fail("unsolicited-grant");
        if (request && !sameControlBinding(request.binding, grant.binding))
          return fail("grant-binding-changed");
        const resumed = row?.grant.grantId === grant.grantId;
        this.grants.set(peerId, {
          grant: structuredClone(grant),
          paused: false,
          reliable: resumed ? row.reliable : 0,
          pointer: resumed ? row.pointer : 0,
          received: now,
          hasSentInput: resumed ? row.hasSentInput : false,
        });
        this.outgoing.delete(peerId);
        this.requestClock(peerId);
        break;
      }
      case "clock-request":
        if (
          id(message.nonce) &&
          Number.isFinite(message.controllerTimeMs) &&
          message.controllerTimeMs >= 0
        )
          this.options.send(peerId, {
            v: 1,
            type: "clock-response",
            nonce: message.nonce,
            controllerTimeMs: message.controllerTimeMs,
            hostTimeMs: now,
          });
        else return fail("invalid-clock-request");
        break;
      case "clock-response": {
        const sample = this.clockPending.get(peerId);
        if (
          !sample ||
          sample.nonce !== message.nonce ||
          sample.sent !== message.controllerTimeMs ||
          !Number.isFinite(message.hostTimeMs) ||
          message.hostTimeMs < 0
        )
          return fail("invalid-clock-sample");
        this.clockPending.delete(peerId);
        if (now - sample.sent > 200) {
          this.drop(peerId, "control-latency-too-high");
          return fail("control-latency-too-high");
        }
        // Conservative host estimate never fabricates future timestamps from wall-clock skew.
        this.clocks.set(peerId, { offset: message.hostTimeMs - now, received: now });
        break;
      }
      default:
        return undefined;
    }
    return ok(undefined);
  }
  dispose(): void {
    this.stopAll("owner-destroyed");
    for (const peer of [...this.shares.keys()]) this.disconnected(peer);
  }
}
