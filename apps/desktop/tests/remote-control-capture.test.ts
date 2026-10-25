import assert from "node:assert/strict";
import test from "node:test";
import { RemoteControlCapture } from "../src/main/remote-control-capture";

test("approved display captures pin physical and DIP geometry; window/changed displays invalidate prior handles", () => {
  let now = 50;
  const capture = new RemoteControlCapture(
    () => [
      {
        id: "left",
        dip: { x: -1280, y: 0, width: 1280, height: 720 },
        physical: { x: -1920, y: 0, width: 1920, height: 1080 },
      },
      {
        id: "main",
        dip: { x: 0, y: 0, width: 1920, height: 1080 },
        physical: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ],
    () => now,
  );
  assert.equal(capture.read(), undefined);
  const first = capture.approve({ id: "screen:1:0", display_id: "left" })!;
  assert.equal(first.displayBoundsPhysical.x, -1920);
  assert.equal(first.virtualDesktopBoundsPhysical.width, 3840);
  assert.equal(capture.lastVideoFrameAtMs, -Infinity);
  assert.equal(capture.markFrame(first.captureHandle, first.geometryVersion), true);
  assert.equal(capture.lastVideoFrameAtMs, 50);
  now = 100;
  const next = capture.approve({ id: "screen:2:0", display_id: "main" })!;
  assert.notEqual(first.captureHandle, next.captureHandle);
  assert.equal(capture.markFrame(first.captureHandle, first.geometryVersion), false);
  assert.equal(capture.lastVideoFrameAtMs, -Infinity);
  assert.equal(capture.approve({ id: "window:1:0", display_id: "main" }), undefined);
  assert.equal(capture.markFrame(next.captureHandle, next.geometryVersion), false);
  assert.equal(capture.approve({ id: "screen:3:0", display_id: "unknown" }), undefined);
});
