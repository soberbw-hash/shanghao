import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { readRendererCss } from "./helpers/read-renderer-css";

const sourceRoot = path.resolve(process.cwd(), "src/renderer/src");
const mainRoot = path.resolve(process.cwd(), "src/main");
const readRenderer = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), "utf8");
const readMain = (relativePath: string) => readFileSync(path.join(mainRoot, relativePath), "utf8");

test("top bar reserves one status row for every connection state", () => {
  const source = readRenderer("components/layout/TopStatusBar.tsx");
  assert.match(source, /const connectionStatus = statusCopy/);
  assert.match(source, /topbar-channel-copy[^`]*min-h-4/);
  assert.match(source, /connectionStatus \|\| "频道状态正常"/);
  assert.doesNotMatch(source, /\{statusCopy\(room\.connectionState\) \? \(/);
});

test("seated characters use an inherited body rig and safe layer overlap", () => {
  const component = readRenderer("components/room/DeskAnimalSprite.tsx");
  const styles = readRendererCss();
  assert.match(component, /className="desk-animal-body-rig"/);
  assert.match(component, /desk-animal-body[\s\S]*desk-animal-head[\s\S]*desk-animal-arm/);
  assert.match(styles, /\.desk-animal-body-rig \{[\s\S]*transform-origin: center bottom/);
  assert.match(styles, /\.desk-animal-head \{[\s\S]*inset\(0 0 47% 0\)/);
  assert.match(styles, /\.desk-animal-body \{[\s\S]*inset\(43% 0 0 0\)/);
  for (const motion of ["idle", "gaming", "speaking", "muted"]) {
    assert.match(styles, new RegExp(`\\.desk-animal-${motion} \\.desk-animal-body-rig`));
  }
});

test("signaling reconnects use generation, one timer chain, and a stable window", () => {
  const mainBridge = readMain("signaling-client.ts");
  const roomClient = readRenderer("features/room/roomClient.ts");
  const coordinator = readRenderer("features/room/SignalingReconnectCoordinator.ts");
  assert.match(mainBridge, /generation: this\.socketGeneration/);
  assert.match(mainBridge, /if \(!isCurrentSocket\(\)\)/);
  assert.match(roomClient, /Ignored duplicate socket close in reconnect episode/);
  assert.match(coordinator, /if \(this\.reconnectTimer !== undefined\) return/);
  assert.match(coordinator, /RECONNECT_STABLE_WINDOW_MS = 3_000/);
  assert.match(coordinator, /this\.activeEpisodeId \?\?= \+\+this\.episodeSequence/);
  assert.match(coordinator, /Signaling reconnect episode reached stable window/);
});

test("reconnect sounds are episode-scoped and initial join cannot play restored", () => {
  const source = readRenderer("hooks/useUiFeedbackSounds.ts");
  assert.match(source, /reconnectEpisodeActiveRef/);
  assert.match(source, /reconnectStableTimerRef/);
  assert.match(source, /}, 3_000\);/);
  assert.match(source, /reconnectFailurePlayedRef/);
  assert.doesNotMatch(source, /previousConnectionRef\.current !== RoomConnectionState\.Connected/);
});
