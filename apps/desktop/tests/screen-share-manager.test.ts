import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isRetryableDisplayCaptureError,
  ScreenShareManager,
} from "../src/renderer/src/features/screen-share/ScreenShareManager";

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = "live";
  stopped = false;

  stop(): void {
    this.stopped = true;
    this.readyState = "ended";
  }

  getSettings(): MediaTrackSettings {
    return { width: 1_280, height: 720, frameRate: 15 };
  }
}

const installCaptureEnvironment = ({ includeAudio }: { includeAudio: boolean }) => {
  const videoTrack = new FakeTrack();
  const audioTrack = new FakeTrack();
  const stream = {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => (includeAudio ? [audioTrack] : []),
    getTracks: () => (includeAudio ? [videoTrack, audioTrack] : [videoTrack]),
  } as unknown as MediaStream;
  const captureRequests: DisplayMediaStreamOptions[] = [];
  const protection: boolean[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout,
      desktopApi: {
        screenCapture: {
          listSources: async () => [
            {
              id: "screen:1",
              name: "显示器 1",
              kind: "screen",
              thumbnailDataUrl: "data:image/png;base64,AA==",
            },
          ],
          selectSource: async () => undefined,
          setContentProtection: async (enabled: boolean) => {
            protection.push(enabled);
          },
        },
        screenShareViewer: {
          open: async () => undefined,
          sendSignal: async () => true,
          close: async () => undefined,
        },
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async (request: DisplayMediaStreamOptions) => {
          captureRequests.push(request);
          return stream;
        },
      },
    },
  });

  return { videoTrack, audioTrack, stream, captureRequests, protection };
};

test("screen share manager owns publishing and cleans every track", async () => {
  const environment = installCaptureEnvironment({ includeAudio: true });
  let startCount = 0;
  let stopCount = 0;
  const manager = new ScreenShareManager({
    startPublishing: async () => {
      startCount += 1;
    },
    stopPublishing: async () => {
      stopCount += 1;
    },
  });

  const sources = await manager.openSourcePicker();
  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.id, "screen:1");
  assert.equal(manager.getSnapshot().sources.length, 1);
  await manager.startShare({
    sourceId: "screen:1",
    includeSystemAudio: true,
  });
  assert.equal(startCount, 1);
  assert.equal(environment.captureRequests[0]?.audio, true);
  assert.equal(manager.getSnapshot().hasSystemAudio, true);

  await manager.stopShare();
  assert.equal(stopCount, 1);
  assert.equal(environment.videoTrack.stopped, true);
  assert.equal(environment.audioTrack.stopped, true);
  assert.deepEqual(environment.protection, [false, true, false]);
  assert.equal(manager.getSnapshot().status, "idle");
});

test("screen share manager keeps video when system audio is disabled", async () => {
  const environment = installCaptureEnvironment({ includeAudio: false });
  const manager = new ScreenShareManager({
    startPublishing: async () => undefined,
    stopPublishing: async () => undefined,
  });

  await manager.startShare({
    sourceId: "screen:1",
    includeSystemAudio: false,
  });
  assert.equal(environment.captureRequests[0]?.audio, false);
  assert.equal(manager.getSnapshot().status, "sharing");
  assert.equal(manager.getSnapshot().hasSystemAudio, false);
  await manager.stopShare();
});

test("screen share manager retries a temporarily unreadable Windows source without loopback audio", async () => {
  const environment = installCaptureEnvironment({ includeAudio: false });
  let attempts = 0;
  const originalCapture = navigator.mediaDevices.getDisplayMedia;
  navigator.mediaDevices.getDisplayMedia = async (request) => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("Could not start video source");
      error.name = "NotReadableError";
      throw error;
    }
    return originalCapture.call(navigator.mediaDevices, request);
  };
  const selectedSources: string[] = [];
  window.desktopApi.screenCapture.selectSource = async (sourceId) => {
    selectedSources.push(sourceId);
  };
  const manager = new ScreenShareManager({
    startPublishing: async () => undefined,
    stopPublishing: async () => undefined,
  });

  await manager.startShare({ sourceId: "window:42", includeSystemAudio: true });

  assert.equal(attempts, 2);
  assert.deepEqual(selectedSources, ["window:42", "window:42"]);
  assert.equal(environment.captureRequests[0]?.audio, false);
  assert.equal(manager.getSnapshot().status, "sharing");
  await manager.stopShare();
});

test("display capture retry only covers transient source startup failures", () => {
  const unreadable = new Error("Could not start video source");
  unreadable.name = "NotReadableError";
  assert.equal(isRetryableDisplayCaptureError(unreadable), true);
  assert.equal(isRetryableDisplayCaptureError(new Error("permission_denied")), false);
});

test("screen source enumeration can be cancelled without reviving stale picker state", async () => {
  const environment = installCaptureEnvironment({ includeAudio: false });
  let resolveSources:
    | ((sources: Awaited<ReturnType<typeof window.desktopApi.screenCapture.listSources>>) => void)
    | undefined;
  const pendingSources = new Promise<
    Awaited<ReturnType<typeof window.desktopApi.screenCapture.listSources>>
  >((resolve) => {
    resolveSources = resolve;
  });
  window.desktopApi.screenCapture.listSources = () => pendingSources;
  const manager = new ScreenShareManager({
    startPublishing: async () => undefined,
    stopPublishing: async () => undefined,
  });

  const openRequest = manager.openSourcePicker();
  await Promise.resolve();
  assert.equal(manager.getSnapshot().status, "enumerating");
  await manager.cancelSourcePicker();
  resolveSources?.([
    {
      id: "screen:stale",
      name: "过期显示器",
      kind: "screen",
      thumbnailDataUrl: "data:image/png;base64,AA==",
    },
  ]);

  assert.deepEqual(await openRequest, []);
  assert.equal(manager.getSnapshot().status, "idle");
  assert.deepEqual(manager.getSnapshot().sources, []);
  assert.deepEqual(environment.protection, [false, false]);
});

test("screen source enumeration can retry after a failure", async () => {
  installCaptureEnvironment({ includeAudio: false });
  const listSources = window.desktopApi.screenCapture.listSources;
  let attempt = 0;
  window.desktopApi.screenCapture.listSources = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("temporary_enumeration_failure");
    return listSources();
  };
  const manager = new ScreenShareManager({
    startPublishing: async () => undefined,
    stopPublishing: async () => undefined,
  });

  await assert.rejects(manager.openSourcePicker(), /temporary_enumeration_failure/);
  assert.equal(manager.getSnapshot().status, "failed");
  assert.equal((await manager.openSourcePicker()).length, 1);
  assert.equal(manager.getSnapshot().status, "source-ready");
});

test("viewer preload exposes only the screen-share viewer bridge", () => {
  const preload = readFileSync(
    new URL("../src/preload/screen-share-viewer.ts", import.meta.url),
    "utf8",
  );
  assert.match(preload, /exposeInMainWorld\("screenShareViewerApi"/);
  assert.doesNotMatch(preload, /settings|clipboard|diagnostics|signaling|overlay|updates/);
  assert.match(preload, /sendSignal/);
  assert.match(preload, /onSignal/);
  assert.match(preload, /close/);
});

test("Windows capture handler only requests loopback audio when the renderer asks for it", () => {
  const source = readFileSync(new URL("../src/main/window.ts", import.meta.url), "utf8");
  assert.match(source, /request\.audioRequested && process\.platform === "win32"/);
  assert.match(
    source,
    /requestedSourceId[\s\S]*sources\.find\(\(source\) => source\.id === requestedSourceId\)/,
  );
});
