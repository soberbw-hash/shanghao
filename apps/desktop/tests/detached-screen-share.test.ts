import assert from "node:assert/strict";
import test from "node:test";
import type { ScreenShareViewerSignal } from "@private-voice/shared";
import { DetachedScreenSharePublisher } from "../src/renderer/src/features/screen-share/DetachedScreenSharePublisher";

test("an unsupported video quality hint cannot strand the enlarged viewer on loading", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalPeer = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  let receive!: (signal: ScreenShareViewerSignal) => void;
  let closed = 0,
    removed = 0;
  const sent: ScreenShareViewerSignal[] = [];
  class Peer {
    connectionState = "new";
    onicecandidate = null;
    onconnectionstatechange = null;
    getSenders() {
      return [
        {
          track: { kind: "video" },
          getParameters: () => ({ encodings: [{}] }),
          setParameters: async () => {
            throw Error("unsupported driver hint");
          },
        },
      ];
    }
    addTrack() {}
    async createOffer() {
      return { type: "offer", sdp: "isolated-offer" };
    }
    async setLocalDescription() {}
    close() {}
  }
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: Peer });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        screenShareViewer: {
          onSignal: (listener: typeof receive) => {
            receive = listener;
            return () => {
              removed++;
            };
          },
          sendSignal: async (signal: ScreenShareViewerSignal) => {
            sent.push(signal);
            return true;
          },
        },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalPeer) Object.defineProperty(globalThis, "RTCPeerConnection", originalPeer);
    else Reflect.deleteProperty(globalThis, "RTCPeerConnection");
  });
  const publisher = new DetachedScreenSharePublisher({
    sessionId: "isolated",
    title: "test",
    stream: { getVideoTracks: () => [{}] } as MediaStream,
    onClosed: () => {
      closed++;
    },
  });
  publisher.start();
  receive({ type: "ready", sender: "viewer", sessionId: "isolated" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    sent.some((signal) => signal.type === "offer" && signal.sdp === "isolated-offer"),
    true,
  );
  assert.equal(closed, 0);
  publisher.destroy();
  assert.equal(removed, 1);
});

test("enlarged viewing follows track changes inside the same stream and ignores a stale item", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalPeer = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  let created = 0,
    closed = 0,
    windowsClosed = 0,
    failOpen = false;
  class Peer {
    onicecandidate = null;
    onconnectionstatechange = null;
    connectionState = "new";
    constructor() {
      created++;
    }
    addTrack() {}
    close() {
      closed++;
    }
  }
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: Peer });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        app: { writeLog: async () => {} },
        screenShareViewer: {
          open: async () => {
            if (failOpen) throw Error("viewer failed");
          },
          close: async () => {
            windowsClosed++;
          },
          onSignal: () => () => {},
          sendSignal: async () => true,
        },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalPeer) Object.defineProperty(globalThis, "RTCPeerConnection", originalPeer);
    else Reflect.deleteProperty(globalThis, "RTCPeerConnection");
  });
  const { ScreenShareManager } =
    await import("../src/renderer/src/features/screen-share/ScreenShareManager");
  const manager = new ScreenShareManager({
    startPublishing: async () => {},
    stopPublishing: async () => {},
  });
  let trackId = "video-1";
  const stream = {
    getVideoTracks: () => [{ id: trackId, kind: "video" }],
  } as unknown as MediaStream;
  const item = {
    id: "friend-screen",
    title: "Friend screen",
    stream,
    transport: "webrtc" as const,
  };
  await manager.openDetachedViewer(item);
  await manager.syncDetachedItem(item);
  assert.equal(created, 1);
  trackId = "video-2";
  await manager.syncDetachedItem(item);
  assert.equal(created, 2);
  assert.equal(closed, 1);
  await manager.syncDetachedItem({ ...item, id: "old-item" });
  assert.equal(windowsClosed, 0);
  assert.equal(manager.getSnapshot().detachedItemId, item.id);
  await manager.syncDetachedItem(undefined);
  assert.equal(closed, 2);
  assert.equal(windowsClosed, 1);
  failOpen = true;
  await assert.rejects(manager.openDetachedViewer(item), /viewer failed/);
  assert.equal(manager.getSnapshot().displayMode, "inline");
});
