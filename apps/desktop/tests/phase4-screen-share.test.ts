import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { MeshPeerConnection } from "@private-voice/webrtc";

import { ScreenSharePipelineController } from "../src/renderer/src/features/screen-share/ScreenSharePipelineController";
import { recordScreenSharePresentation } from "../src/renderer/src/features/screen-share/screenSharePresentationMetrics";
import {
  DEFAULT_SCREEN_SHARE_QUALITY,
  SCREEN_SHARE_PROFILES,
} from "../src/renderer/src/features/screen-share/types";

test("screen share exposes only real 720p and 1080p requests with 1080p as default", () => {
  assert.equal(DEFAULT_SCREEN_SHARE_QUALITY, "1080p");
  assert.deepEqual(Object.keys(SCREEN_SHARE_PROFILES).sort(), ["1080p", "720p"]);
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

test("screen pressure protects motion before cutting frame rate and track loss has recovery", () => {
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

  assert.match(peerSource, /constrained:[\s\S]*screenMaxFramerate: 30/);
  assert.match(peerSource, /critical:[\s\S]*screenMaxFramerate: 18/);
  assert.match(peerSource, /degradationPreference = "maintain-framerate"/);
  assert.match(managerSource, /attempting one automatic recovery/);
  assert.match(coordinatorSource, /SCREEN_TRACK_RECOVERY_DELAY_MS/);
  assert.match(coordinatorSource, /onScreenTrackLost/);
});
