import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { ScreenShareManager } from "../src/renderer/src/features/screen-share/ScreenShareManager";
import { SCREEN_SHARE_PROFILES } from "../src/renderer/src/features/screen-share/types";

const installCaptureFixture = (t: TestContext, failProtectionEnable = false) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const protection: boolean[] = [];
  let stoppedTracks = 0;
  const videoTrack = {
    contentHint: "",
    applyConstraints: async () => undefined,
    getSettings: () => ({ width: 1_920, height: 1_080, frameRate: 30 }),
    addEventListener: () => undefined,
    stop: () => {
      stoppedTracks += 1;
    },
  } as unknown as MediaStreamTrack;
  const stream = {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [],
    getTracks: () => [videoTrack],
  } as unknown as MediaStream;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout: (callback: () => void) => setTimeout(callback, 0),
      desktopApi: {
        screenCapture: {
          selectSource: async () => undefined,
          setContentProtection: async (enabled: boolean) => {
            protection.push(enabled);
            if (enabled && failProtectionEnable) throw new Error("screen_protection_failed");
          },
        },
        screenShareViewer: { close: async () => undefined },
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getDisplayMedia: async () => stream } },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  return { protection, getStoppedTracks: () => stoppedTracks };
};

test("failed screen publishing rolls back the owned publishing session", async (t) => {
  const fixture = installCaptureFixture(t);
  let rollbacks = 0;
  const manager = new ScreenShareManager({
    startPublishing: async () => {
      throw new Error("screen_sender_failed");
    },
    stopPublishing: async () => {
      rollbacks += 1;
    },
  });

  await assert.rejects(
    manager.startShare({ sourceId: "display-one", includeSystemAudio: false }),
    /screen_sender_failed/,
  );
  assert.equal(rollbacks, 1);
  assert.equal(fixture.getStoppedTracks(), 1);
  assert.equal(manager.getSnapshot().status, "failed");
  assert.deepEqual(fixture.protection, [false]);
});

test("a failure after publishing stops the old screen stream before reporting failure", async (t) => {
  const fixture = installCaptureFixture(t, true);
  let rollbacks = 0;
  const manager = new ScreenShareManager({
    startPublishing: async () => undefined,
    stopPublishing: async () => {
      rollbacks += 1;
    },
  });

  await assert.rejects(
    manager.startShare({ sourceId: "display-one", includeSystemAudio: false }),
    /screen_protection_failed/,
  );
  assert.equal(rollbacks, 1);
  assert.equal(fixture.getStoppedTracks(), 1);
  assert.deepEqual(fixture.protection, [true, false]);
  assert.equal(manager.getSnapshot().status, "failed");
});

test("a superseded start cannot roll back a newer screen share operation", async (t) => {
  const fixture = installCaptureFixture(t);
  let rejectPublishing = (_error: Error) => undefined;
  const publishing = new Promise<void>((_resolve, reject) => {
    rejectPublishing = reject;
  });
  let rollbacks = 0;
  const manager = new ScreenShareManager({
    startPublishing: async () => publishing,
    stopPublishing: async () => {
      rollbacks += 1;
    },
  });

  const starting = manager.startShare({ sourceId: "display-one", includeSystemAudio: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stopping = manager.stopShare("superseded");
  rejectPublishing(new Error("old_sender_failed"));
  await stopping;
  await assert.rejects(starting, /old_sender_failed/);
  assert.equal(rollbacks, 1, "the old start must not stop publishing twice");
  assert.equal(manager.getSnapshot().status, "idle");
  assert.deepEqual(fixture.protection, [false]);
});

test("a newer share waits for the old stop before enabling capture protection", async (t) => {
  const fixture = installCaptureFixture(t);
  let finishStopping = () => undefined;
  const stopping = new Promise<void>((resolve) => {
    finishStopping = resolve;
  });
  const manager = new ScreenShareManager({
    startPublishing: async () => undefined,
    stopPublishing: async () => stopping,
  });

  await manager.startShare({ sourceId: "display-one", includeSystemAudio: false });
  const oldStop = manager.stopShare("switch-source");
  const restarting = manager.startShare({ sourceId: "display-two", includeSystemAudio: false });
  await Promise.resolve();
  assert.deepEqual(fixture.protection, [true]);
  finishStopping();
  await oldStop;
  await restarting;

  assert.equal(manager.getSnapshot().status, "sharing");
  assert.deepEqual(fixture.protection, [true, false, true]);
});

test("stop waits for an in-flight publish before detaching its track", async (t) => {
  installCaptureFixture(t);
  let finishPublishing = () => undefined;
  const publishing = new Promise<void>((resolve) => {
    finishPublishing = resolve;
  });
  const events: string[] = [];
  const manager = new ScreenShareManager({
    startPublishing: async () => {
      events.push("publishing-started");
      await publishing;
      events.push("publishing-finished");
    },
    stopPublishing: async () => {
      events.push("publishing-stopped");
    },
  });

  const starting = manager.startShare({ sourceId: "display-one", includeSystemAudio: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stopping = manager.stopShare("user");
  assert.deepEqual(events, ["publishing-started"]);
  finishPublishing();
  await stopping;
  await assert.rejects(starting, /screen_share_superseded/);
  assert.deepEqual(events, ["publishing-started", "publishing-finished", "publishing-stopped"]);
});

test("stopping during screen track recovery waits for its replacement publish", async (t) => {
  installCaptureFixture(t);
  let finishRecoveryPublish = () => undefined;
  const recoveryPublishing = new Promise<void>((resolve) => {
    finishRecoveryPublish = resolve;
  });
  const events: string[] = [];
  let publishCount = 0;
  const manager = new ScreenShareManager({
    startPublishing: async () => {
      publishCount += 1;
      events.push(`publish-${publishCount}`);
      if (publishCount === 2) await recoveryPublishing;
    },
    stopPublishing: async () => {
      events.push("stop");
    },
  });
  const request = { sourceId: "display-one", includeSystemAudio: false };
  const oldStream = await manager.startShare(request);
  const recovering = (
    manager as unknown as {
      recoverEndedTrack: (
        request: typeof request,
        profile: (typeof SCREEN_SHARE_PROFILES)["1080p"],
        stream: MediaStream,
      ) => Promise<void>;
    }
  ).recoverEndedTrack(request, SCREEN_SHARE_PROFILES["1080p"], oldStream);
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["publish-1", "stop", "publish-2"]);
  const stopping = manager.stopShare("user");
  finishRecoveryPublish();
  await Promise.all([recovering, stopping]);
  assert.deepEqual(events, ["publish-1", "stop", "publish-2", "stop"]);
  assert.equal(manager.getSnapshot().status, "idle");
});

test("destroy waits for an in-flight publish before releasing its sender", async (t) => {
  installCaptureFixture(t);
  let finishPublishing = () => undefined;
  const publishing = new Promise<void>((resolve) => {
    finishPublishing = resolve;
  });
  let stopped = 0;
  const manager = new ScreenShareManager({
    startPublishing: async () => publishing,
    stopPublishing: async () => {
      stopped += 1;
    },
  });
  const starting = manager.startShare({ sourceId: "display-one", includeSystemAudio: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
  manager.destroy();
  assert.equal(stopped, 0);
  finishPublishing();
  await assert.rejects(starting, /screen_share_superseded/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stopped, 1);
});
