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

test("top bar centers normal room information and only shows a status row for connection notices", () => {
  const source = readRenderer("components/layout/TopStatusBar.tsx");
  assert.match(source, /const connectionStatus = statusCopy/);
  assert.match(source, /\{connectionStatus && \(/);
  assert.match(source, /topbar-channel-copy[\s\S]*role="status"/);
  assert.doesNotMatch(source, /topbar-channel-copy[^`]*min-h-4/);
  assert.doesNotMatch(source, /connectionStatus \|\| "频道状态正常"/);
  assert.doesNotMatch(source, /\{statusCopy\(room\.connectionState\) \? \(/);
});

test("seated characters animate one complete portrait without head and body seams", () => {
  const component = readRenderer("components/room/DeskAnimalSprite.tsx");
  const styles = readRendererCss();
  assert.match(component, /className="desk-animal-body-rig"/);
  assert.match(component, /className="desk-animal-layer desk-animal-portrait"/);
  assert.doesNotMatch(component, /desk-animal-head|desk-animal-arm/);
  assert.match(styles, /\.desk-animal-body-rig \{[\s\S]*transform-origin: center bottom/);
  assert.doesNotMatch(styles, /\.desk-animal-portrait\s*\{[^}]*clip-path:/s);
  for (const motion of ["idle", "gaming", "speaking", "muted"]) {
    assert.match(styles, new RegExp(`\\.desk-animal-${motion} \\.desk-animal-body-rig`));
  }
  for (const action of ["look", "stretch", "sip", "blink", "ear", "yawn", "type", "phone"]) {
    assert.match(styles, new RegExp(`\\.desk-animal-action-${action} \\.desk-animal-body-rig`));
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
  const source = readRenderer("features/audio/roomSoundFeedback.ts");
  assert.match(source, /this\.episode/);
  assert.match(source, /this\.recoveryTimer/);
  assert.match(source, /}, 3_000\);/);
  assert.match(source, /this\.failurePlayed/);
  assert.doesNotMatch(source, /previousConnectionRef\.current !== RoomConnectionState\.Connected/);
});
