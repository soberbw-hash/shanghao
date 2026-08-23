import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { MeshPeerConnection } from "@private-voice/webrtc";

import { ScreenSharePipelineController } from "../src/renderer/src/features/screen-share/ScreenSharePipelineController";
import {
  SCREEN_FALLBACK_TARGET_FPS,
  ScreenShareViewerTracker,
} from "../src/renderer/src/features/screen-share/screenSharePolicy";
import { recordScreenSharePresentation } from "../src/renderer/src/features/screen-share/screenSharePresentationMetrics";
import {
  DEFAULT_SCREEN_SHARE_QUALITY,
  SCREEN_SHARE_PROFILES,
} from "../src/renderer/src/features/screen-share/types";

test("screen share exposes 720p, 1080p and 1440p requests with 1080p as default", () => {
  assert.equal(DEFAULT_SCREEN_SHARE_QUALITY, "1080p");
  assert.deepEqual(Object.keys(SCREEN_SHARE_PROFILES).sort(), ["1080p", "1440p", "720p"]);
  assert.deepEqual(SCREEN_SHARE_PROFILES["720p"], {
    maxBitrate: 3_000_000,
    maxFramerate: 30,
    maxWidth: 1_280,
    maxHeight: 720,
  });
  assert.deepEqual(SCREEN_SHARE_PROFILES["1080p"], {
    maxBitrate: 6_000_000,
    maxFramerate: 30,
    maxWidth: 1_920,
    maxHeight: 1_080,
  });
  assert.deepEqual(SCREEN_SHARE_PROFILES["1440p"], {
    maxBitrate: 10_000_000,
    maxFramerate: 30,
    maxWidth: 2_560,
    maxHeight: 1_440,
  });
});

test("screen pipeline keeps requested, actual capture, send, decode, present and fallback separate", async () => {
  const pipeline = new ScreenSharePipelineController();
  const startedAt = Date.now();
  pipeline.setLocalCapture(
    {
      getSettings: () => ({ width: 1_300, height: 700, frameRate: 28 }),
    } as MediaStreamTrack,
    SCREEN_SHARE_PROFILES["1080p"],
  );
  recordScreenSharePresentation("peer-b", {
    framesPerSecond: 27,
    width: 1_280,
    height: 720,
    sampledAt: startedAt,
  });
  const peer = {
    getScreenShareSenderStats: async () => ({
      sampledAt: startedAt,
      width: 1_280,
      height: 720,
      framesPerSecond: 29,
      bitrateBps: 2_400_000,
    }),
    getScreenShareReceiverStats: async () => ({
      sampledAt: startedAt,
      width: 1_280,
      height: 720,
      framesPerSecond: 28,
      framesDropped: 2,
      freezeCount: 1,
      bitrateBps: 2_100_000,
    }),
  } as unknown as MeshPeerConnection;
  await pipeline.sample(new Map([["peer-b", peer]]), new Set(["peer-b"]));
  pipeline.setFallback(true, 1);

  const snapshot = pipeline.snapshot(startedAt + 9_000);
  assert.deepEqual(snapshot.requested, {
    width: 1_920,
    height: 1_080,
    framesPerSecond: 30,
    maxBitrateBps: 6_000_000,
  });
  assert.deepEqual(snapshot.capture, { width: 1_300, height: 700, framesPerSecond: 28 });
  assert.equal(snapshot.send["peer-b"]?.framesPerSecond, 29);
  assert.equal(snapshot.receive["peer-b"]?.framesDropped, 2);
  assert.equal(snapshot.present["peer-b"]?.framesPerSecond, 27);
  assert.equal(snapshot.fallback.overdue, true);
});

test("screen pressure preserves at least 24 FPS and fallback is video-capable", () => {
  const peerSource = readFileSync(
    new URL("../../../packages/webrtc/src/createPeer.ts", import.meta.url),
    "utf8",
  );
  const managerSource = readFileSync(
    new URL("../src/renderer/src/features/screen-share/ScreenShareManager.ts", import.meta.url),
    "utf8",
  );
  const coordinatorSource = readFileSync(
    new URL(
      "../src/renderer/src/features/screen-share/RoomScreenShareCoordinator.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const relaySource = readFileSync(
    new URL("../src/renderer/src/features/screen-share/ScreenFrameRelay.ts", import.meta.url),
    "utf8",
  );
  const panelSource = readFileSync(
    new URL("../src/renderer/src/components/room/ScreenSharePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(peerSource, /constrained:[\s\S]*screenMaxFramerate: 30/);
  assert.match(peerSource, /critical:[\s\S]*screenMaxFramerate: 24/);
  assert.match(peerSource, /critical:[\s\S]*screenScaleResolutionDownBy: 1/);
  assert.match(peerSource, /degradationPreference = "maintain-framerate"/);
  assert.match(peerSource, /contentHint = "motion"/);
  assert.match(managerSource, /attempting one automatic recovery/);
  assert.match(coordinatorSource, /SCREEN_TRACK_RECOVERY_DELAY_MS/);
  assert.match(coordinatorSource, /onScreenTrackLost/);
  assert.equal(SCREEN_FALLBACK_TARGET_FPS, 24);
  assert.match(coordinatorSource, /Math\.ceil\(1_000 \/ SCREEN_FALLBACK_TARGET_FPS\)/);
  assert.match(relaySource, /captureInFlight/);
  assert.match(relaySource, /toDataURL\("image\/webp"/);
  assert.match(panelSource, /网络受限 · 备用画面/);
  assert.match(panelSource, /framesPerSecond/);
});

test("screen share reuses path acknowledgements for viewer presence", () => {
  const viewers = new ScreenShareViewerTracker();
  assert.equal(viewers.setActive("viewer-b", true), true);
  assert.equal(viewers.setActive("viewer-a", true), true);
  assert.equal(viewers.setActive("viewer-a", true), false);
  assert.deepEqual(viewers.snapshot(), ["viewer-a", "viewer-b"]);
  assert.equal(viewers.setActive("viewer-a", false), true);
  assert.deepEqual(viewers.snapshot(), ["viewer-b"]);
  assert.equal(viewers.clear(), true);
  assert.deepEqual(viewers.snapshot(), []);
});

test("the sharer gets viewer names and a one-minute no-viewer stop", () => {
  const audienceSource = readFileSync(
    new URL("../src/renderer/src/features/screen-share/useScreenShareAudience.ts", import.meta.url),
    "utf8",
  );
  const panelSource = readFileSync(
    new URL("../src/renderer/src/components/room/ScreenSharePanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(audienceSource, /SCREEN_SHARE_NO_VIEWER_TIMEOUT_SECONDS = 60/);
  assert.match(audienceSource, /stopShare\("no-viewers"\)/);
  assert.match(audienceSource, /正在观看你的屏幕/);
  assert.match(panelSource, /正在观看：/);
  assert.match(panelSource, /秒后自动停止/);
});

test("screen-share and shared floating windows use readable backdrop blur", () => {
  const visualStyles = readFileSync(
    new URL("../src/renderer/src/styles/parts/140-visual-experience.css", import.meta.url),
    "utf8",
  );
  assert.match(visualStyles, /\.screen-share-panel[\s\S]*backdrop-filter: blur\(30px\)/);
  assert.match(visualStyles, /\.modal-surface,[\s\S]*backdrop-filter: blur\(24px\)/);
  assert.match(visualStyles, /\.modal-scrim,[\s\S]*backdrop-filter: blur\(8px\)/);
  assert.match(visualStyles, /\.weather-city-dialog::backdrop/);
});
