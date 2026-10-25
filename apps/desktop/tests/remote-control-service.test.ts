import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  RemoteControlService,
  type RemoteControlNativeClient,
  type HostShareInfo,
  type RemoteControlWireMessage,
} from "../src/main/remote-control-service";
import type { RemoteControlHostState, NativeInputSink } from "../src/main/remote-control-session";
import type { AuthenticatedMembership } from "../src/main/signaling-membership";
import type {
  RemoteControlGrant,
  RemoteControlInputEnvelope,
  RemoteControlMemberIdentity,
  RemoteControlNativeCommand,
  RemoteControlRequest,
} from "../../../packages/shared/src/types/remote-control.types";

const member = (peerId: string): RemoteControlMemberIdentity => ({
  peerId,
  deviceId: "device-" + peerId,
  memberSessionId: "session-" + peerId,
  memberGeneration: 1,
});
const local = member("local"),
  friend = member("friend"),
  other = member("other");
const fixture = (t: TestContext) => {
  let now = 1000,
    tick = () => {};
  const sent: { peer: string; message: RemoteControlWireMessage; lane: string }[] = [];
  const inputs: RemoteControlNativeCommand[] = [];
  const releases: Parameters<NativeInputSink["invalidateAndRelease"]>[0][] = [];
  let created = 0,
    prepared = 0,
    disposed = 0,
    nativeSafety: () => void = () => {};
  let capability = { supported: true, emergencyStopReady: true, dryRun: false };
  let prepare = async () => ({ ...capability });
  let activate = async () => true;
  let sendAllowed = (message: RemoteControlWireMessage) => message.type.length > 0;
  const membership: AuthenticatedMembership = {
    roomId: "room-a",
    host: local,
    members: [local, friend, other],
    names: { local: "本机", friend: "好友", other: "另一好友" },
  };
  const host: RemoteControlHostState = {
    roomId: membership.roomId,
    host: local,
    members: membership.members,
    roomActive: true,
    connected: true,
    locked: false,
    permissionGranted: true,
    inputSupported: true,
    emergencyStopReady: false,
    lastVideoFrameAtMs: now,
    share: {
      kind: "screen",
      shareSessionId: "local-share",
      captureHandle: "capture-local",
      displayId: "display-local",
      geometryVersion: 1,
      displayBoundsDip: { x: 0, y: 0, width: 1280, height: 720 },
      displayBoundsPhysical: { x: 0, y: 0, width: 1920, height: 1080 },
      virtualDesktopBoundsPhysical: { x: 0, y: 0, width: 1920, height: 1080 },
    },
  };
  const service = new RemoteControlService({
    readHostState: () => host,
    readMembership: () => membership,
    now: () => now,
    scheduleTick: (callback) => {
      tick = callback;
      return () => {};
    },
    send: (peer, message, lane) => {
      sent.push({ peer, message, lane });
      return sendAllowed(message);
    },
    createNative: (onSafetyStop) => {
      created++;
      nativeSafety = () => onSafetyStop("fake-worker-stop");
      const fake: RemoteControlNativeClient = {
        activateGrant: () => activate(),
        prepare: () => {
          prepared++;
          return prepare();
        },
        execute: async (command) => {
          inputs.push(command);
          return true;
        },
        invalidateAndRelease: (lease) => {
          releases.push(lease);
        },
        dispose: () => {
          disposed++;
        },
      };
      return fake;
    },
  });
  t.after(() => service.dispose());
  service.onCapability(friend.peerId, true);
  service.onCapability(other.peerId, true);
  const request = (requestId = "request-a"): RemoteControlWireMessage => ({
    v: 1,
    type: "request-control",
    requestId,
    shareSessionId: "local-share",
  });
  const remoteShare: HostShareInfo = {
    roomId: membership.roomId,
    shareSessionId: "remote-share",
    captureHandle: "capture-remote",
    displayId: "display-remote",
    geometryVersion: 1,
    owner: friend,
    kind: "screen",
    width: 1920,
    height: 1080,
    requestable: true,
  };
  return {
    service,
    sent,
    inputs,
    releases,
    host,
    membership,
    remoteShare,
    request,
    advance: (ms: number, fresh = true) => {
      now += ms;
      if (fresh) host.lastVideoFrameAtMs = now;
    },
    tick: () => tick(),
    nativeSafety: () => nativeSafety(),
    counts: () => ({ created, prepared, disposed }),
    setCapability: (value: typeof capability) => {
      capability = value;
    },
    setPrepare: (value: typeof prepare) => {
      prepare = value;
    },
    setActivate: (value: typeof activate) => {
      activate = value;
    },
    setSend: (value: typeof sendAllowed) => {
      sendAllowed = value;
    },
  };
};
const remoteGrant = (
  f: ReturnType<typeof fixture>,
  request: RemoteControlRequest,
): RemoteControlGrant => ({
  grantId: "remote-grant",
  generation: 1,
  binding: request.binding,
  permissions: ["pointer", "keyboard", "text"],
  issuedAtMs: 1000,
  expiresAtMs: 601000,
});

test("native grant activation must finish before advertising success; failure or cancellation cannot leave a grant", async (t) => {
  for (const cancel of [false, true]) {
    const f = fixture(t);
    let finish!: (ready: boolean) => void;
    f.setActivate(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await f.service.receive(friend.peerId, f.request());
    const approval = f.service.approveFromLocalUser("request-a", "ten-minutes");
    for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
    assert.ok(finish);
    assert.equal(f.service.snapshot().host.grant, undefined);
    assert.equal(
      f.sent.some((row) => row.message.type === "grant"),
      false,
    );
    if (cancel) f.service.onLocalSafetyEvent("local-input");
    finish(cancel);
    assert.equal((await approval).ok, false);
    assert.equal(f.service.snapshot().host.grant, undefined);
    assert.equal(f.inputs.length, 0);
  }
});

test("request is inert; only explicit local approval prepares native and creates the host grant", async (t) => {
  const f = fixture(t);
  assert.equal((await f.service.receive(friend.peerId, f.request())).ok, true);
  assert.deepEqual(f.counts(), { created: 0, prepared: 0, disposed: 0 });
  assert.equal(f.service.snapshot().host.grant, undefined);
  const approved = await f.service.approveFromLocalUser("request-a", "ten-minutes");
  assert.equal(approved.ok, true);
  assert.equal(f.counts().prepared, 1);
  assert.equal(f.inputs.length, 0);
  assert.equal(f.service.snapshot().host.grant?.binding.controller.peerId, friend.peerId);
  assert.ok(f.sent.some((row) => row.peer === friend.peerId && row.message.type === "grant"));
});

test("legacy request identity/geometry/clock claims are ignored and request ID collisions cannot replace consent", async (t) => {
  const f = fixture(t);
  const forged = {
    requestId: "same-id",
    binding: {
      roomId: "forged",
      shareSessionId: "local-share",
      captureHandle: "forged",
      displayId: "forged",
      geometryVersion: 999,
      target: other,
      controller: other,
    },
    requestedAtMs: 0,
    expiresAtMs: 1e15,
  };
  assert.equal(
    (await f.service.receive(friend.peerId, { v: 1, type: "request", request: forged })).ok,
    true,
  );
  const row = f.service.snapshot().incomingRequests[0]!;
  assert.equal(row.binding.controller.peerId, friend.peerId);
  assert.equal(row.binding.target.peerId, local.peerId);
  assert.equal(row.binding.captureHandle, "capture-local");
  assert.equal(row.expiresAtMs, 31000);
  assert.equal((await f.service.receive(other.peerId, f.request("same-id"))).ok, false);
  assert.equal(f.service.snapshot().incomingRequests[0]!.binding.controller.peerId, friend.peerId);
});

test("window share, forged sender and capability loss cannot create pending permission", async (t) => {
  const f = fixture(t);
  assert.equal((await f.service.receive("not-a-member", f.request())).ok, false);
  f.host.share!.kind = "window";
  assert.equal((await f.service.receive(friend.peerId, f.request())).ok, false);
  f.host.share!.kind = "screen";
  f.service.onCapability(friend.peerId, false);
  assert.equal((await f.service.receive(friend.peerId, f.request())).ok, false);
  assert.equal(f.counts().created, 0);
});

test("read-only/dry-run or missing emergency hotkey rejects approval and disposes prepared worker", async (t) => {
  for (const capability of [
    { supported: false, emergencyStopReady: false, dryRun: false },
    { supported: true, emergencyStopReady: true, dryRun: true },
    { supported: true, emergencyStopReady: false, dryRun: false },
  ]) {
    const f = fixture(t);
    f.setCapability(capability);
    await f.service.receive(friend.peerId, f.request());
    assert.equal((await f.service.approveFromLocalUser("request-a", "share-lifetime")).ok, false);
    assert.equal(f.service.snapshot().host.grant, undefined);
    assert.equal(f.inputs.length, 0);
    assert.equal(f.counts().disposed, 1);
  }
});

test("cancel/share/member change during native prepare makes its late completion powerless", async (t) => {
  for (const change of ["cancel", "share", "member", "local-stop"]) {
    const f = fixture(t);
    let finish: (value: {
      supported: boolean;
      emergencyStopReady: boolean;
      dryRun: boolean;
    }) => void = () => {};
    f.setPrepare(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await f.service.receive(friend.peerId, f.request());
    const pending = f.service.approveFromLocalUser("request-a", "share-lifetime");
    if (change === "cancel")
      await f.service.receive(friend.peerId, { v: 1, type: "cancel", requestId: "request-a" });
    if (change === "share") {
      f.host.share!.shareSessionId = "different-share";
      f.service.refresh();
    }
    if (change === "member") {
      f.membership.members = f.membership.members.map((row) =>
        row.peerId === friend.peerId ? { ...row, memberGeneration: 2 } : row,
      );
      f.service.refresh();
    }
    if (change === "local-stop") f.service.onLocalSafetyEvent("local-input");
    finish({ supported: true, emergencyStopReady: true, dryRun: false });
    assert.equal((await pending).ok, false);
    assert.equal(f.service.snapshot().host.grant, undefined);
    assert.equal(f.counts().disposed, 1);
  }
});

test("trusted generation replacement and local safety release current native input immediately", async (t) => {
  const f = fixture(t);
  await f.service.receive(friend.peerId, f.request());
  await f.service.approveFromLocalUser("request-a", "share-lifetime");
  const grant = f.service.snapshot().host.grant!;
  const input: RemoteControlInputEnvelope = {
    grantId: grant.grantId,
    generation: grant.generation,
    binding: grant.binding,
    sequence: 1,
    hostTimeMs: 1000,
    event: { kind: "key", code: "ControlLeft", pressed: true },
  };
  assert.equal((await f.service.receive(friend.peerId, { v: 1, type: "input", input })).ok, true);
  f.membership.members = f.membership.members.map((row) =>
    row.peerId === friend.peerId ? { ...row, memberGeneration: 2 } : row,
  );
  f.service.refresh();
  assert.equal(f.releases.length, 1);
  assert.deepEqual(f.releases[0]!.keys, ["ControlLeft"]);
  assert.equal((await f.service.receive(friend.peerId, f.request("stale-channel"))).ok, false);
  assert.equal(f.service.snapshot().host.grant, undefined);
});

test("native failure and stale actual video frames change authorization without remote cooperation", async (t) => {
  for (const mode of ["native", "video", "share"]) {
    const f = fixture(t);
    await f.service.receive(friend.peerId, f.request());
    await f.service.approveFromLocalUser("request-a", "share-lifetime");
    if (mode === "native") f.nativeSafety();
    if (mode === "video") {
      f.advance(1501, false);
      f.tick();
    }
    if (mode === "share") {
      f.host.share = undefined;
      f.service.refresh();
    }
    assert.equal(f.releases.length, 1);
    assert.equal(f.service.snapshot().host.phase, mode === "video" ? "paused" : "revoked");
  }
});

test("failed grant delivery is a failed approval, never a successful UI authorization", async (t) => {
  const f = fixture(t);
  await f.service.receive(friend.peerId, f.request());
  f.setSend((message) => message.type !== "grant");
  const approved = await f.service.approveFromLocalUser("request-a", "ten-minutes");
  assert.equal(approved.ok, false);
  assert.equal(f.service.snapshot().host.grant, undefined);
});

test("remote grant is accepted only for a local request and can never grant this computer", async (t) => {
  const f = fixture(t);
  await f.service.receive(friend.peerId, { v: 1, type: "share-info", share: f.remoteShare });
  const request = f.service.requestControl(friend.peerId);
  assert.equal(request.ok, true);
  if (!request.ok) return;
  const grant = remoteGrant(f, request.value);
  assert.equal((await f.service.receive(other.peerId, { v: 1, type: "grant", grant })).ok, false);
  assert.equal((await f.service.receive(friend.peerId, { v: 1, type: "grant", grant })).ok, true);
  assert.equal(f.service.snapshot().host.grant, undefined);
  assert.equal(f.counts().created, 0);
  assert.ok(f.service.snapshot().remoteGrants[friend.peerId]);
  const unsolicited = fixture(t);
  await unsolicited.service.receive(friend.peerId, {
    v: 1,
    type: "share-info",
    share: unsolicited.remoteShare,
  });
  assert.equal(
    (await unsolicited.service.receive(friend.peerId, { v: 1, type: "grant", grant })).ok,
    false,
  );
});

test("clock binding, real frame freshness, pause/resume sequences and cleanup gate outgoing input", async (t) => {
  const f = fixture(t);
  await f.service.receive(friend.peerId, { v: 1, type: "share-info", share: f.remoteShare });
  const requested = f.service.requestControl(friend.peerId);
  if (!requested.ok) throw Error(requested.reason);
  const grant = remoteGrant(f, requested.value);
  await f.service.receive(friend.peerId, { v: 1, type: "grant", grant });
  const clock = f.sent.find((row) => row.message.type === "clock-request")!.message;
  if (clock.type !== "clock-request") throw Error("clock");
  assert.equal(
    (
      await f.service.receive(friend.peerId, {
        v: 1,
        type: "clock-response",
        nonce: "wrong",
        controllerTimeMs: clock.controllerTimeMs,
        hostTimeMs: 1000,
      })
    ).ok,
    false,
  );
  await f.service.receive(friend.peerId, {
    v: 1,
    type: "clock-response",
    nonce: clock.nonce,
    controllerTimeMs: clock.controllerTimeMs,
    hostTimeMs: 1000,
  });
  assert.equal(
    f.service.sendInput(friend.peerId, { kind: "key", code: "KeyA", pressed: true }, "reliable").ok,
    false,
  );
  f.service.observeRemoteFrame(friend.peerId, "remote-share");
  assert.equal(
    f.service.sendInput(friend.peerId, { kind: "key", code: "KeyA", pressed: true }, "reliable").ok,
    true,
  );
  await f.service.receive(friend.peerId, {
    v: 1,
    type: "pause",
    grantId: grant.grantId,
    generation: grant.generation,
  });
  assert.equal(
    f.service.sendInput(friend.peerId, { kind: "key", code: "KeyA", pressed: true }, "reliable").ok,
    false,
  );
  await f.service.receive(friend.peerId, {
    v: 1,
    type: "grant",
    grant: { ...grant, generation: 3 },
  });
  f.service.observeRemoteFrame(friend.peerId, "remote-share");
  assert.equal(
    f.service.sendInput(friend.peerId, { kind: "key", code: "KeyA", pressed: false }, "reliable")
      .ok,
    true,
  );
  const inputs = f.sent
    .filter((row) => row.message.type === "input")
    .map((row) => (row.message.type === "input" ? row.message.input.sequence : 0));
  assert.deepEqual(inputs, [1, 2]);
  f.advance(1501);
  f.tick();
  assert.equal(f.service.snapshot().remoteGrants[friend.peerId], undefined);
  assert.ok(
    f.sent.some((row) => row.message.type === "revoke" && row.message.reason === "video-stale"),
  );
});
