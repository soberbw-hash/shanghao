import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { FlightRecorder } from "../src/main/flight-recorder";

const desktopRoot = path.resolve(process.cwd());
const repoRoot = path.resolve(desktopRoot, "../..");
const readDesktop = (relativePath: string) =>
  readFileSync(path.join(desktopRoot, relativePath), "utf8");
const readRepo = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

test("flight recorder is bounded and removes private log context", () => {
  const recorder = new FlightRecorder(10 * 60_000, 2);
  const now = Date.now();
  recorder.recordLog({
    timestamp: new Date(now).toISOString(),
    category: "signaling",
    level: "info",
    message: "connected",
    context: {
      latencyMs: 42,
      recordingPath: "C:\\Users\\person\\voice.wav",
      transcript: "private speech",
      token: "secret",
    },
  });
  recorder.record({
    timestamp: new Date(now + 1).toISOString(),
    source: "realtime",
    level: "warn",
    event: "second",
  });
  recorder.record({
    timestamp: new Date(now + 2).toISOString(),
    source: "realtime",
    level: "warn",
    event: "third",
  });

  const snapshot = recorder.snapshot(now + 3);
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.droppedEvents, 1);
  assert.equal(JSON.stringify(snapshot).includes("private speech"), false);
  assert.equal(JSON.stringify(snapshot).includes("voice.wav"), false);
});

test("runtime health uses real Electron and animation-frame measurements", () => {
  const mainHealth = readDesktop("src/main/runtime-health.ts");
  const appSource = readDesktop("src/renderer/src/app/App.tsx");
  const settingsSource = readDesktop("src/renderer/src/pages/SettingsPage.tsx");
  const rendererMonitor = readDesktop(
    "src/renderer/src/features/diagnostics/rendererPerformanceMonitor.ts",
  );
  const visualRuntime = readDesktop(
    "src/renderer/src/features/visual-runtime/VisualRuntimeController.ts",
  );
  assert.match(mainHealth, /app\.getAppMetrics\(\)/);
  assert.match(mainHealth, /app\.getGPUFeatureStatus\(\)/);
  assert.match(mainHealth, /display\.displayFrequency/);
  assert.match(visualRuntime, /requestAnimationFrame/);
  assert.match(rendererMonitor, /displayRefreshRateService\.getRefreshRateHz/);
  assert.match(rendererMonitor, /frameTimeP99Ms/);
  assert.doesNotMatch(rendererMonitor, /actualFps:\s*120/);
  assert.doesNotMatch(appSource, /rendererPerformanceMonitor\.start\(\)/);
  assert.match(settingsSource, /rendererPerformanceMonitor\.start\(\)/);
  assert.match(settingsSource, /stopPerformanceMonitor\(\)/);
});

test("diagnostic IPC and bundle expose health without ordinary fault-lab UI", () => {
  const channels = readRepo("packages/shared/src/constants/ipc.ts");
  const ipc = readDesktop("src/main/ipc.ts");
  const diagnosticsCard = readDesktop(
    "src/renderer/src/components/settings/DiagnosticsSettingsCard.tsx",
  );
  assert.match(channels, /runtimeHealth: "diagnostics:runtime-health"/);
  assert.match(ipc, /runtime-health\.json/);
  assert.match(ipc, /flight-recorder\.json/);
  assert.match(diagnosticsCard, /import\.meta\.env\.DEV/);
  assert.match(diagnosticsCard, /Realtime Fault Lab/);
});

test("screen-share diagnostics use a readable idle state and reveal real metrics on demand", () => {
  const diagnosticsCard = readDesktop(
    "src/renderer/src/components/settings/DiagnosticsSettingsCard.tsx",
  );

  assert.match(diagnosticsCard, /hasScreenShareMetrics/);
  assert.match(diagnosticsCard, /未开始屏幕分享/);
  assert.match(diagnosticsCard, /请求 \/ 实际采集/);
  assert.match(diagnosticsCard, /编码 \/ 码率/);
  assert.doesNotMatch(diagnosticsCard, /Requested \/ Capture/);
  assert.doesNotMatch(diagnosticsCard, /Encode \/ Bitrate/);
});
