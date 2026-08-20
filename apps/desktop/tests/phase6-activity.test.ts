import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ACTIVITY_FALLBACK_POLL_INTERVAL_MS,
  WORK_ACTIVITY_RULES,
} from "../src/main/game-detection";
import { readRendererCss } from "./helpers/read-renderer-css";

const readSource = (relativePath: string): string =>
  readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

test("work presence is independently controlled and actively cleared", () => {
  const settings = readSource("src/renderer/src/pages/SettingsPage.tsx");
  const room = readSource("src/renderer/src/pages/RoomPage.tsx");
  const ipc = readSource("src/main/ipc.ts");
  const detector = readSource("src/main/game-detection.ts");

  assert.ok(settings.includes('label="开启工作显示"'));
  assert.ok(room.includes("visibleMembers"));
  assert.ok(room.includes("workActivity: undefined"));
  assert.ok(ipc.includes("setWorkActivityEnabled(settings.isWorkActivityVisible)"));
  assert.ok(
    detector.includes('message: enabled ? "work_activity_enabled" : "work_activity_cleared"'),
  );
  assert.ok(detector.includes("const work = includeWorkActivity"));
  assert.ok(detector.includes("this.workActivityEnabled"));
});

test("activity fallback is 20 seconds and common office apps are excluded", () => {
  assert.equal(ACTIVITY_FALLBACK_POLL_INTERVAL_MS, 20_000);
  const ids = new Set(WORK_ACTIVITY_RULES.map((rule) => rule.id));
  for (const id of ["word", "excel", "powerpoint", "visio", "wps", "notion"]) {
    assert.equal(ids.has(id), false, `${id} must not be public work presence`);
  }
  for (const id of [
    "codex",
    "vscode",
    "cursor",
    "premiere",
    "photoshop",
    "blender",
    "unity",
    "unreal",
  ]) {
    assert.equal(ids.has(id), true, `${id} must remain a professional work app`);
  }
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
