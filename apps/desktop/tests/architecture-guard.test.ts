import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const desktopRoot = path.resolve(process.cwd());
const workspaceRoot = path.resolve(desktopRoot, "../..");
const read = (relativePath: string) => readFileSync(path.join(workspaceRoot, relativePath), "utf8");
const lineCount = (relativePath: string) => read(relativePath).split(/\r?\n/).length;

test("renderer style entry remains an ordered composition instead of a God file", () => {
  const entryPath = "apps/desktop/src/renderer/src/styles/index.css";
  const entry = read(entryPath);
  assert.ok(lineCount(entryPath) <= 50, "styles/index.css must contain imports only");
  assert.doesNotMatch(entry, /\{[^}]*\}/s);

  const partDirectory = path.join(workspaceRoot, "apps/desktop/src/renderer/src/styles/parts");
  const parts = readdirSync(partDirectory).filter((name) => name.endsWith(".css"));
  assert.ok(parts.length >= 10, "the renderer stylesheet must stay split by responsibility");
  // Frozen at the reviewed baseline. New CSS responsibilities need a named part;
  // existing parts should only shrink as duplicated rules are retired.
  const partCeilings: Record<string, number> = {
    "00-base.css": 181,
    "10-screen-share.css": 96,
    "100-scene-weather.css": 1976,
    "110-component-polish.css": 1376,
    "115-recording-player-title.css": 31,
    "120-ai.css": 427,
    "130-final-material.css": 1936,
    "140-visual-experience.css": 1555,
    "150-account.css": 1098,
    "160-sensory-polish.css": 266,
    "170-model-comparison.css": 545,
    "175-voice-memory-organization.css": 147,
    "176-ai-model-management.css": 107,
    "180-room-asset-pass.css": 463,
    "190-room-glass-unification.css": 434,
    "195-phone-mic.css": 182,
    "20-activity-shell.css": 917,
    "200-settings-refinement.css": 365,
    "205-scene-life.css": 405,
    "30-glass-pages.css": 724,
    "40-room-scene.css": 663,
    "50-character.css": 1134,
    "60-chat-recording-settings.css": 1591,
    "70-motion.css": 414,
    "80-update.css": 25,
    "90-visual-polish.css": 993,
  };
  for (const part of parts) {
    const relativePath = `apps/desktop/src/renderer/src/styles/parts/${part}`;
    assert.ok(partCeilings[part] !== undefined, `${part} needs an explicit reviewed ceiling`);
    assert.ok(
      lineCount(relativePath) <= partCeilings[part]!,
      `${part} grew beyond its reviewed ceiling`,
    );
    assert.match(entry, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("large orchestration entry points stay below reviewed growth ceilings", () => {
  const ceilings = {
    // Reviewed: replacement/rollback implementation remains in the audio helper;
    // the facade adds only its typed call and the missing-mix failure guard.
    // Reviewed growth: room exit completes resource cleanup when screen-audio
    // microphone restoration fails; the normal media path is unchanged.
    // Reviewed growth: repeated disconnect callers now await the same cleanup.
    "apps/desktop/src/renderer/src/features/room/roomClient.ts": 1_715,
    "apps/desktop/src/renderer/src/hooks/useRoomState.ts": 1_621,
    "apps/desktop/src/renderer/src/pages/RoomPage.tsx": 1_373,
    // lineCount includes the final newline; growth requires reviewing the
    // added responsibility and updating the ceiling deliberately.
    // Reviewed growth: the diagnostic export now includes a bounded cross-domain event timeline.
    "apps/desktop/src/main/ipc.ts": 1_453,
    // Reviewed growth: model actions are serialized per model, late initialization
    // cannot restart downloads, and AI compute admission delegates to ResourceScheduler.
    // The extra lines expose active cancellation state, notify status listeners,
    // and defer Qwen pressure release until a manual job gives up its lease.
    // Reviewed growth: download waiter cancellation closes an admission race.
    // Reviewed growth: damaged state fails closed before model deletion or checkpoint writes.
    "apps/desktop/src/main/ai-model-manager.ts": 1_616,
    "apps/desktop/src/main/ai-runtime-manager.ts": 1_850,
    "packages/signaling/src/server.ts": 1_841,
    // Reviewed Windows appearance disclosure keeps its risk text beside the controls.
    "apps/desktop/src/renderer/src/pages/SettingsPage.tsx": 516,
    // Reviewed: the scene gained a bounded decorative corner layer and visibility gating.
    "apps/desktop/src/renderer/src/components/room/TeamIsland.tsx": 702,
    "apps/desktop/src/renderer/src/components/chat/TemporaryChatPanel.tsx": 944,
    // Reviewed growth: timestamp-ordered observations use a bounded binary-search scan.
    // Per-record setup now serializes clear/start/delete so a delayed job cannot
    // recreate a deleted memory or append events after comparison results are cleared.
    "apps/desktop/src/main/ai-voice-memory-service.ts": 2_915,
    "apps/desktop/src/main/voice-memory-transcription-units.ts": 288,
    "apps/desktop/src/main/voice-memory-observation.ts": 74,
    "apps/desktop/src/renderer/src/components/settings/SettingsDiagnosticsSection.tsx": 231,
    "apps/desktop/src/renderer/src/components/settings/useDiagnosticsRefresh.ts": 113,
  } as const;
  for (const [relativePath, ceiling] of Object.entries(ceilings)) {
    assert.ok(
      lineCount(relativePath) <= ceiling,
      `${relativePath} grew beyond its reviewed ceiling of ${ceiling} lines`,
    );
  }
});

test("new 3.0 boundaries are explicit, typed and independently bounded", () => {
  const guardedModules = [
    "apps/desktop/src/main/platform/PlatformService.ts",
    "apps/desktop/src/main/screen-capture-service.ts",
    "apps/desktop/src/main/rust-core-client.ts",
    "apps/desktop/src/renderer/src/core/shanghaoCore.ts",
    "apps/desktop/src/renderer/src/features/visual-runtime/DisplayRefreshRateService.ts",
    "apps/desktop/src/renderer/src/features/visual-runtime/VisualRuntimeController.ts",
    "apps/desktop/src/renderer/src/features/visual-runtime/RoomAnimationScheduler.ts",
    "apps/desktop/src/renderer/src/features/visual-runtime/sceneFeatureRegistry.ts",
    "apps/desktop/src/main/process-tree.ts",
    "apps/desktop/src/main/runtime-health-trend.ts",
    "apps/desktop/src/main/recording-stream-ipc.ts",
    "apps/desktop/src/main/recording-tracks-ipc.ts",
    "apps/desktop/src/main/recording-marker-ipc.ts",
    "apps/desktop/src/main/recording-ipc-validation.ts",
    "apps/desktop/src/main/voice-memory-ipc-validation.ts",
    "apps/desktop/src/renderer/src/components/chat/RoomChatPanel.tsx",
    "apps/desktop/src/renderer/src/features/settings/settingsSectionState.ts",
    "apps/desktop/src/renderer/src/features/voice-scene/visibleSceneMembers.ts",
    "apps/desktop/src/renderer/src/features/room/departedPeerState.ts",
    "packages/signaling/src/account-room-profile-sync.ts",
  ];
  for (const module of guardedModules) {
    assert.ok(lineCount(module) <= 500, `${module} must be split before it reaches 500 lines`);
  }

  const platform = read("apps/desktop/src/main/platform/PlatformService.ts");
  const capture = read("apps/desktop/src/main/screen-capture-service.ts");
  const rendererCore = read("apps/desktop/src/renderer/src/core/shanghaoCore.ts");
  const nativeBridge = read("apps/desktop/src/main/rust-core-client.ts");
  assert.match(platform, /WindowsPlatformService/);
  assert.match(platform, /MacOSPlatformService/);
  assert.match(capture, /class ScreenCaptureService/);
  assert.match(rendererCore, /createShangHaoCore/);
  assert.match(rendererCore, /AbortSignal/);
  assert.match(rendererCore, /timeoutMs/);
  assert.doesNotMatch(rendererCore, /ipcRenderer|invoke\s*\(/);
  assert.match(nativeBridge, /class RustCoreClient/);
  assert.match(nativeBridge, /request_id/);

  const mainRoot = path.join(workspaceRoot, "apps/desktop/src/main");
  const mainSources = readdirSync(mainRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((filePath) => !filePath.endsWith(path.join("platform", "PlatformService.ts")));
  for (const filePath of mainSources) {
    assert.doesNotMatch(
      readFileSync(filePath, "utf8"),
      /process\.platform/,
      `${path.relative(workspaceRoot, filePath)} bypasses PlatformService`,
    );
  }
});

test("preload keeps explicit IPC capabilities and never exposes a universal invoke", () => {
  const preload = read("apps/desktop/src/preload/index.ts");
  const sharedApi = read("packages/shared/src/types/ipc.types.ts");
  assert.match(preload, /const desktopApi: DesktopApi/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("desktopApi", desktopApi\)/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*ipcRenderer\)/);
  assert.doesNotMatch(sharedApi, /invoke\s*:\s*\(/);
});

test("Rust workspace stays focused and does not duplicate realtime or AI algorithms", () => {
  const workspace = read("native/Cargo.toml");
  const rustCore = read("native/crates/shanghao-core/src/main.rs");
  assert.match(workspace, /crates\/shanghao-core/);
  assert.match(rustCore, /ActivitySnapshot/);
  assert.match(rustCore, /FileIdentity/);
  assert.match(rustCore, /SuperviseProcess/);
  assert.doesNotMatch(rustCore, /WebRTC|DeepFilter|VAD|VibeVoice|Qwen/);
});
