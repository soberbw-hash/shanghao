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
  for (const part of parts) {
    const relativePath = `apps/desktop/src/renderer/src/styles/parts/${part}`;
    assert.ok(lineCount(relativePath) <= 2_000, `${part} grew beyond its reviewed ceiling`);
    assert.match(entry, new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("large orchestration entry points stay below reviewed growth ceilings", () => {
  const ceilings = {
    "apps/desktop/src/renderer/src/features/room/roomClient.ts": 1_700,
    "apps/desktop/src/renderer/src/pages/RoomPage.tsx": 1_515,
    // lineCount includes the final newline; these are the current reviewed
    // baselines, so any future growth fails until responsibility is extracted.
    "apps/desktop/src/main/ipc.ts": 1_500,
    "apps/desktop/src/main/ai-model-manager.ts": 1_455,
    "apps/desktop/src/main/ai-runtime-manager.ts": 1_489,
    "packages/signaling/src/server.ts": 1_850,
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
