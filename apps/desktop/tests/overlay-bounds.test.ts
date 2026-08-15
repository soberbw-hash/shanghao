import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  centerOverlayTop,
  isPointInsideOverlay,
  resizeOverlayKeepingTop,
  snapOverlayTop,
} from "../src/main/overlay-bounds";

const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

test("member joins resize the overlay without cumulative vertical drift", () => {
  let bounds = { x: 6, y: 420, width: 142, height: 46 };

  for (const height of [86, 126, 166, 206, 206, 206]) {
    bounds = resizeOverlayKeepingTop(bounds, height, workArea, 6, 142);
    assert.equal(bounds.y, 420);
  }
});

test("member joins only move an overlay upward when the new rows would leave the screen", () => {
  const bounds = resizeOverlayKeepingTop(
    { x: 6, y: 1010, width: 142, height: 46 },
    206,
    workArea,
    6,
    142,
  );

  assert.deepEqual(bounds, { x: 6, y: 868, width: 142, height: 206 });
});

test("vertical dragging snaps locally to the display grid and stays on screen", () => {
  assert.equal(snapOverlayTop(427, 126, workArea, 16), 432);
  assert.equal(snapOverlayTop(2_000, 126, workArea, 16), 948);
  assert.equal(centerOverlayTop(126, workArea), 477);
});

test("hover hit testing includes the overlay surface but excludes its outside edge", () => {
  const bounds = { x: 6, y: 420, width: 142, height: 86 };
  assert.equal(isPointInsideOverlay({ x: 6, y: 420 }, bounds), true);
  assert.equal(isPointInsideOverlay({ x: 147, y: 505 }, bounds), true);
  assert.equal(isPointInsideOverlay({ x: 148, y: 505 }, bounds), false);
});

test("native hover tracking drives the one-second overlay position affordance", () => {
  const mainSource = readFileSync(
    new URL("../src/main/overlay-window.ts", import.meta.url),
    "utf8",
  );
  const rendererSource = readFileSync(
    new URL("../src/renderer/src/pages/OverlayPage.tsx", import.meta.url),
    "utf8",
  );
  const preloadSource = readFileSync(new URL("../src/preload/overlay.ts", import.meta.url), "utf8");

  assert.match(mainSource, /IPC_CHANNELS\.overlay\.hoverState/);
  assert.match(preloadSource, /IPC_CHANNELS\.overlay\.hoverState/);
  assert.match(rendererSource, /onHoverState/);
  assert.match(rendererSource, /TOOLS_REVEAL_SECONDS = 1/);
  assert.match(rendererSource, /strokeDashoffset: 98/);
  assert.match(rendererSource, /attr: \{ strokeDashoffset: 0 \}/);
  assert.match(rendererSource, /overlay-still-progress-track/);
  assert.match(rendererSource, /overlay-still-progress-value/);
});
