import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ACTIVITY_FALLBACK_POLL_INTERVAL_MS } from "../src/main/game-detection";
import { readRendererCss } from "./helpers/read-renderer-css";

const readSource = (relativePath: string): string =>
  readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

test("professional work presence has been removed from settings, detection and room UI", () => {
  const settings = readSource("src/renderer/src/pages/SettingsPage.tsx");
  const room = readSource("src/renderer/src/pages/RoomPage.tsx");
  const ipc = readSource("src/main/ipc.ts");
  const detector = readSource("src/main/game-detection.ts");
  const protocol = readSource("../../packages/signaling/src/protocol.ts");

  for (const source of [settings, room, ipc, detector, protocol]) {
    assert.equal(source.includes("workActivity"), false);
    assert.equal(source.includes("isWorkActivityVisible"), false);
  }
  assert.ok(detector.includes("matchKnownGameActivity"));
  assert.ok(detector.includes("matchMediaSessionMusicActivity"));
});

test("game and music activity fallback remains 20 seconds", () => {
  assert.equal(ACTIVITY_FALLBACK_POLL_INTERVAL_MS, 20_000);
});

test("application identity and icon resolution are cached outside the renderer", () => {
  const identity = readSource("src/main/app-identity-resolver.ts");
  const icon = readSource("src/main/app-icon-resolver.ts");

  for (const evidence of [
    "processName",
    "executablePath",
    "productName",
    "fileDescription",
    "packageFamilyName",
    "appUserModelId",
    "windowOwnerProcessName",
    "parentProcessId",
  ]) {
    assert.ok(identity.includes(evidence), `${evidence} identity evidence is missing`);
  }
  assert.ok(icon.includes("private readonly cache"));
  assert.ok(icon.includes("AppxManifest.xml"));
  assert.ok(icon.includes("targetsize-128"));
  assert.ok(icon.includes('getFileIcon(identity.executablePath, { size: "large" })'));
  assert.ok(icon.includes('createHash("sha256")'));
});

test("lifecycle recovery reconciles activity and overlay after Windows state changes", () => {
  const lifecycle = readSource("src/main/lifecycle-recovery-service.ts");
  const index = readSource("src/main/index.ts");
  const overlay = readSource("src/main/overlay-window.ts");
  const bootstrap = readSource("src/renderer/src/hooks/useAppBootstrap.ts");
  const remoteAudio = readSource("src/renderer/src/features/audio/RemoteAudioRenderer.tsx");

  for (const eventName of [
    "suspend",
    "resume",
    "lock-screen",
    "unlock-screen",
    "user-did-become-active",
    "display-added",
    "display-removed",
    "display-metrics-changed",
  ]) {
    assert.ok(lifecycle.includes(eventName), `${eventName} lifecycle event is missing`);
  }
  assert.ok(index.includes("overlay.reconcileDisplayBounds()"));
  assert.ok(index.includes("gameDetection.reconcile(reason)"));
  assert.ok(overlay.includes("reconcileDisplayBounds"));
  assert.ok(index.includes("IPC_CHANNELS.app.lifecycleRecovery"));
  assert.ok(bootstrap.includes("handleDeviceChange()"));
  assert.ok(remoteAudio.includes('mixer.unlock("window-visible")'));
  assert.ok(remoteAudio.includes("shanghao:lifecycle-recovery"));
});

test("every idle workstation uses the animated blue-sky monitor", () => {
  const idleMonitor = readSource("src/renderer/src/components/room/IdleMonitorContent.tsx");
  const styles = readRendererCss();

  assert.ok(idleMonitor.includes("idle-monitors/window-sky.png"));
  assert.equal(idleMonitor.includes("aquarium"), false);
  assert.ok(styles.includes("idle-monitor-drift"));
  assert.equal(styles.includes("idle-monitor-crossfade"), false);
});
