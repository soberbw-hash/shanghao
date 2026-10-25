import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteControlSession,
  normalizeRemotePointer,
  type NativeInputSink,
  type RemoteControlHostState,
} from "../src/main/remote-control-session";
import type {
  RemoteControlInputEnvelope,
  RemoteControlMemberIdentity,
  RemoteControlNativeCommand,
} from "../../../packages/shared/src/types/remote-control.types";

const member = (peerId: string): RemoteControlMemberIdentity => ({
  peerId,
  memberSessionId: `session-${peerId}`,
  memberGeneration: 1,
  deviceId: `device-${peerId}`,
});
const controller = member("controller");
const fixture = () => {
  let now = 1_000;
  let watchdog: () => void = () => {};
  const executions: RemoteControlNativeCommand[] = [];
  const releases: Parameters<NativeInputSink["invalidateAndRelease"]>[0][] = [];
  let execute = async (_command: RemoteControlNativeCommand) => true;
  let hostReadFails = false;
  const sink: NativeInputSink = {
    execute: (command) => {
      executions.push(command);
      return execute(command);
    },
    invalidateAndRelease: (lease) => {
      releases.push(lease);
    },
  };
  const host: RemoteControlHostState = {
    roomId: "room-a",
    host: member("host"),
    members: [controller, member("other")],
    roomActive: true,
    connected: true,
    locked: false,
    permissionGranted: true,
    inputSupported: true,
    emergencyStopReady: true,
    lastVideoFrameAtMs: now,
    share: {
      kind: "screen",
      shareSessionId: "share-a",
      captureHandle: "capture-a",
      displayId: "left",
      geometryVersion: 1,
      displayBoundsDip: { x: -1280, y: 0, width: 1280, height: 720 },
      displayBoundsPhysical: { x: -1920, y: 0, width: 1920, height: 1080 },
      virtualDesktopBoundsPhysical: { x: -1920, y: 0, width: 3840, height: 1080 },
    },
  };
  const session = new RemoteControlSession({
    readHostState: () => {
      if (hostReadFails) throw Error("capture owner gone");
      return host;
    },
    sink,
    now: () => now,
    scheduleWatchdog: (callback) => {
      watchdog = callback;
      return () => {};
    },
  });
  const approve = (duration: "ten-minutes" | "share-lifetime" = "ten-minutes") => {
    const request = session.request(controller);
    assert.equal(request.ok, true);
    if (!request.ok) throw new Error(request.reason);
    const approval = session.approveFromLocalUser(request.value.requestId, duration);
    assert.equal(approval.ok, true);
    if (!approval.ok) throw new Error(approval.reason);
    return approval.value;
  };
  const packet = (sequence = 1): RemoteControlInputEnvelope => {
    const grant = session.snapshot().grant!;
    return {
      grantId: grant.grantId,
      generation: grant.generation,
      binding: grant.binding,
      sequence,
      hostTimeMs: now,
      event: { kind: "key", code: "ControlLeft", pressed: true },
    };
  };
  return {
    session,
    host,
    executions,
    releases,
    approve,
    packet,
    advance: (ms: number, fresh = true) => {
      now += ms;
      if (fresh) host.lastVideoFrameAtMs = now;
    },
    watchdog: () => watchdog(),
    setExecute: (handler: typeof execute) => {
      execute = handler;
    },
    failHostRead: () => {
      hostReadFails = true;
    },
  };
};

test("only explicit local approval creates a random grant, one controller at a time", () => {
  const f = fixture();
  assert.equal(f.session.snapshot().grant, undefined);
  const first = f.approve();
  assert.match(first.grantId, /^[0-9a-f-]{36}$/);
  assert.equal(first.expiresAtMs, 601_000);
  assert.equal(f.session.request(member("other")).ok, false);
  f.session.revokeFromLocalUser();
  const next = f.approve("share-lifetime");
  assert.notEqual(next.grantId, first.grantId);
  assert.ok(next.generation > first.generation);
  assert.equal(next.expiresAtMs, null);
});

test("request cancel, deny and deadline make late approval impossible", () => {
  const f = fixture();
  const first = f.session.request(controller);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(f.session.cancel(controller, first.value.requestId).ok, true);
  assert.equal(f.session.approveFromLocalUser(first.value.requestId, "ten-minutes").ok, false);
  const denied = f.session.request(controller);
  if (!denied.ok) throw Error(denied.reason);
  f.session.denyFromLocalUser(denied.value.requestId);
  assert.equal(f.session.approveFromLocalUser(denied.value.requestId, "ten-minutes").ok, false);
  const expired = f.session.request(controller);
  if (!expired.ok) throw Error(expired.reason);
  f.advance(30_001);
  f.watchdog();
  assert.equal(f.session.approveFromLocalUser(expired.value.requestId, "ten-minutes").ok, false);
});

test("window sharing, unverified members and missing local emergency capability cannot grant", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.host.share!.kind = "window";
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.members = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.emergencyStopReady = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.inputSupported = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.permissionGranted = false;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(f.session.request(controller).ok, false);
    assert.equal(f.executions.length, 0);
  }
});

test("replay, stale/future timestamps and unbound grant/member/share inputs never reach native sink", async () => {
  const f = fixture();
  f.approve();
  assert.equal((await f.session.acceptInput(controller, f.packet(), "reliable")).ok, true);
  assert.equal((await f.session.acceptInput(controller, f.packet(), "reliable")).ok, false);
  for (const mutate of [
    (p: RemoteControlInputEnvelope) => {
      p.grantId = "stale";
    },
    (p: RemoteControlInputEnvelope) => {
      p.generation++;
    },
    (p: RemoteControlInputEnvelope) => {
      p.binding = { ...p.binding, roomId: "room-b" };
    },
    (p: RemoteControlInputEnvelope) => {
      p.binding = { ...p.binding, shareSessionId: "share-b" };
    },
    (p: RemoteControlInputEnvelope) => {
      p.hostTimeMs -= 251;
    },
    (p: RemoteControlInputEnvelope) => {
      p.hostTimeMs += 51;
    },
  ]) {
    const p = f.packet(2);
    mutate(p);
    assert.equal((await f.session.acceptInput(controller, p, "reliable")).ok, false);
  }
  assert.equal((await f.session.acceptInput(member("other"), f.packet(2), "reliable")).ok, false);
  assert.equal(f.executions.length, 1);
});

test("pointer lane cannot release keys or consume reliable sequence numbers", async () => {
  const f = fixture();
  f.approve();
  const move = f.packet(20);
  move.event = { kind: "pointer", x: 0, y: 1 };
  assert.equal((await f.session.acceptInput(controller, move, "pointer")).ok, true);
  assert.equal((await f.session.acceptInput(controller, f.packet(1), "pointer")).ok, false);
  assert.equal((await f.session.acceptInput(controller, f.packet(1), "reliable")).ok, true);
  const up = f.packet(2);
  up.event = { kind: "key", code: "ControlLeft", pressed: false };
  assert.equal((await f.session.acceptInput(controller, up, "reliable")).ok, true);
});

test("pause and emergency stop invalidate input and release owned modifier/button state before any ack", async () => {
  const f = fixture();
  f.approve();
  await f.session.acceptInput(controller, f.packet(1), "reliable");
  const down = f.packet(2);
  down.event = { kind: "button", button: "left", pressed: true, x: 0.5, y: 0.5 };
  await f.session.acceptInput(controller, down, "reliable");
  f.session.pauseFromLocalUser();
  assert.equal(f.session.snapshot().phase, "paused");
  assert.deepEqual(f.releases[0]!.keys, ["ControlLeft"]);
  assert.deepEqual(f.releases[0]!.buttons, ["left"]);
  assert.equal((await f.session.acceptInput(controller, f.packet(3), "reliable")).ok, false);
  assert.equal(f.session.resumeFromLocalUser().ok, true);
  f.session.emergencyStop();
  assert.equal(f.session.snapshot().phase, "revoked");
  assert.equal(f.session.resumeFromLocalUser().ok, false);
});

test("expiry, identity/capture changes, disconnection and lock revoke without remote cooperation", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.advance(600_001),
    (f: ReturnType<typeof fixture>) => {
      f.host.roomActive = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.connected = false;
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.locked = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.share = undefined;
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.share!.captureHandle = "new-capture";
    },
    (f: ReturnType<typeof fixture>) => {
      f.host.members[0] = { ...controller, memberGeneration: 2 };
    },
  ]) {
    const f = fixture();
    f.approve();
    mutate(f);
    f.watchdog();
    assert.equal(f.session.snapshot().grant, undefined);
    assert.equal(f.releases.length, 1);
  }
});

test("stale video pauses input and requires a fresh frame plus explicit local resume", async () => {
  const f = fixture();
  f.approve();
  f.advance(1_501, false);
  f.watchdog();
  assert.equal(f.session.snapshot().phase, "paused");
  assert.equal(f.session.resumeFromLocalUser().ok, false);
  f.advance(0);
  assert.equal(f.session.resumeFromLocalUser().ok, true);
});

test("invalid coordinates, unsupported keys, oversized text and wheel floods are rejected", async () => {
  const f = fixture();
  f.approve();
  const invalid = [
    { kind: "pointer", x: -0.1, y: 0 },
    { kind: "pointer", x: Number.NaN, y: 0 },
    { kind: "key", code: "RunShell", pressed: true },
    { kind: "text", text: "x".repeat(129) },
    { kind: "text", text: "a\0b" },
    { kind: "wheel", x: 0, y: 0, deltaX: 0, deltaY: 1_201 },
    { kind: "shell", command: "whoami" },
  ];
  for (const event of invalid) {
    const p = f.packet();
    p.event = event as RemoteControlInputEnvelope["event"];
    assert.equal(
      (
        await f.session.acceptInput(
          controller,
          p,
          event.kind === "pointer" ? "pointer" : "reliable",
        )
      ).ok,
      false,
    );
  }
  assert.equal(f.executions.length, 0);
});

test("DPI/negative display origin maps within the trusted monitor and virtual desktop", async () => {
  const f = fixture();
  f.approve();
  const p = f.packet();
  p.event = { kind: "pointer", x: 0, y: 1 };
  await f.session.acceptInput(controller, p, "pointer");
  const event = f.executions[0]!.event;
  assert.equal(event.kind, "pointer");
  if (event.kind !== "pointer") return;
  assert.equal(event.xPhysical, -1920);
  assert.equal(event.yPhysical, 1079);
  assert.equal(event.absoluteX, 0);
  assert.equal(event.absoluteY, 65535);
  assert.equal(event.xDip, -1280);
});

test("viewer mapping removes black bars and applies CSS zoom/pan before normalization", () => {
  const view = {
    viewport: { x: 100, y: 50, width: 1000, height: 1000 },
    videoWidth: 1920,
    videoHeight: 1080,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
  assert.equal(normalizeRemotePointer(view, 600, 60), undefined);
  assert.deepEqual(normalizeRemotePointer(view, 600, 550), { x: 0.5, y: 0.5 });
  assert.deepEqual(normalizeRemotePointer({ ...view, zoom: 2, panX: 100 }, 700, 550), {
    x: 0.5,
    y: 0.5,
  });
  assert.equal(normalizeRemotePointer(view, -1, 550), undefined);
});

test("late native completion cannot reactivate a revoked generation and failure revokes", async () => {
  const f = fixture();
  f.approve();
  let complete: (success: boolean) => void = () => {};
  f.setExecute(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const pending = f.session.acceptInput(controller, f.packet(), "reliable");
  f.session.emergencyStop();
  complete(true);
  assert.equal((await pending).ok, false);
  assert.equal(f.session.snapshot().grant, undefined);
  assert.deepEqual(f.releases[0]!.keys, ["ControlLeft"]);
  f.approve();
  f.setExecute(async () => false);
  assert.equal((await f.session.acceptInput(controller, f.packet(), "reliable")).ok, false);
  assert.equal(f.session.snapshot().grant, undefined);
});

test("emergency cleanup still owns a key while its native key-up acknowledgement is pending", async () => {
  const f = fixture();
  f.approve();
  await f.session.acceptInput(controller, f.packet(1), "reliable");
  let complete: (success: boolean) => void = () => {};
  f.setExecute(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const up = f.packet(2);
  up.event = { kind: "key", code: "ControlLeft", pressed: false };
  const pending = f.session.acceptInput(controller, up, "reliable");
  f.session.emergencyStop();
  assert.deepEqual(f.releases[0]!.keys, ["ControlLeft"]);
  complete(true);
  assert.equal((await pending).ok, false);
});

test("stalled native execution has a deadline, releases held state and cannot auto-retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.approve();
  f.setExecute(() => new Promise(() => {}));
  const pending = f.session.acceptInput(controller, f.packet(), "reliable");
  t.mock.timers.tick(250);
  assert.equal((await pending).ok, false);
  assert.equal(f.session.snapshot().grant, undefined);
  assert.equal(f.executions.length, 1);
  assert.deepEqual(f.releases[0]!.keys, ["ControlLeft"]);
});

test("queued input/rate limits pause and release instead of building unbounded native work", async () => {
  const f = fixture();
  f.approve();
  const complete: ((success: boolean) => void)[] = [];
  f.setExecute(
    () =>
      new Promise((resolve) => {
        complete.push(resolve);
      }),
  );
  const pending = Array.from({ length: 16 }, (_, index) =>
    f.session.acceptInput(controller, f.packet(index + 1), "reliable"),
  );
  assert.equal((await f.session.acceptInput(controller, f.packet(17), "reliable")).ok, false);
  assert.equal(f.session.snapshot().phase, "paused");
  assert.equal(f.executions.length, 16);
  assert.deepEqual(f.releases[0]!.keys, ["ControlLeft"]);
  complete.forEach((resolve) => resolve(true));
  await Promise.all(pending);
  const rate = fixture();
  rate.approve();
  for (let sequence = 1; sequence <= 241; sequence++) {
    const packet = rate.packet(sequence);
    packet.event = { kind: "pointer", x: 0.5, y: 0.5 };
    const result = await rate.session.acceptInput(controller, packet, "pointer");
    assert.equal(result.ok, sequence <= 240);
  }
  assert.equal(rate.session.snapshot().phase, "paused");
});

test("snapshot mutation and other members cannot steal authority or stop the active controller", async () => {
  const f = fixture();
  const grant = f.approve();
  const oldPacket = f.packet();
  const snapshot = f.session.snapshot();
  snapshot.grant!.binding.roomId = "evil";
  assert.equal(f.session.snapshot().grant!.binding.roomId, "room-a");
  assert.equal(f.session.stopFromController(member("other"), grant.grantId).ok, false);
  assert.equal(f.session.stopFromController(controller, grant.grantId).ok, true);
  assert.equal((await f.session.acceptInput(controller, oldPacket, "reliable")).ok, false);
});

test("Chinese Unicode commits work while isolated surrogates and control characters fail", async () => {
  const f = fixture();
  f.approve();
  const valid = f.packet();
  valid.event = { kind: "text", text: "测试中文🙂" };
  assert.equal((await f.session.acceptInput(controller, valid, "reliable")).ok, true);
  const malformed = f.packet(2);
  malformed.event = { kind: "text", text: "\ud800" };
  assert.equal((await f.session.acceptInput(controller, malformed, "reliable")).ok, false);
  assert.equal(f.executions.length, 1);
});

test("capture provider failure fails closed and releases without an uncaught watchdog exception", () => {
  const f = fixture();
  f.approve();
  f.failHostRead();
  assert.doesNotThrow(() => f.watchdog());
  assert.equal(f.session.snapshot().grant, undefined);
  assert.equal(f.releases.length, 1);
  assert.equal(f.session.request(controller).ok, false);
});

test("pending grants bind target device/display and are invalidated by every immediate safety callback", () => {
  const pending = fixture();
  const request = pending.session.request(controller);
  assert.equal(request.ok, true);
  if (!request.ok) return;
  pending.host.share!.displayId = "different-monitor";
  assert.equal(
    pending.session.approveFromLocalUser(request.value.requestId, "share-lifetime").ok,
    false,
  );
  for (const reason of [
    "room-left",
    "share-stopped",
    "screen-locked",
    "permission-revoked",
    "owner-destroyed",
    "app-suspend",
    "local-input",
    "connection-lost",
    "native-worker-failed",
  ] as const) {
    const f = fixture();
    f.approve();
    f.session.onSafetyEvent(reason);
    assert.equal(f.session.snapshot().grant, undefined);
    assert.equal(f.releases.length, 1);
  }
  const f = fixture();
  f.approve();
  f.session.onPeerDisconnected("other");
  assert.ok(f.session.snapshot().grant);
  f.session.onPeerDisconnected(controller.peerId);
  assert.equal(f.session.snapshot().grant, undefined);
});
