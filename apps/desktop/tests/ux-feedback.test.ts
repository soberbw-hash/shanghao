import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { toUserFacingError } from "../src/renderer/src/utils/userFacingError";

const readRenderer = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), "src/renderer/src", relativePath), "utf8");

test("ordinary UI errors explain the next step without exposing runtime internals", () => {
  const cudaError = toUserFacingError(
    new Error("qwen3_asr_cuda_required: c10_cuda.dll failed to load"),
    "model",
  );
  assert.equal(cudaError.title, "AI GPU 运行环境异常");
  assert.match(cudaError.description, /修复组件/);
  assert.equal(cudaError.description.includes("c10_cuda.dll"), false);

  const integrityError = toUserFacingError(new Error("sha256 integrity mismatch"), "model");
  assert.equal(integrityError.title, "模型文件校验未通过");
  assert.match(integrityError.description, /重新校验并修复/);
  assert.equal(integrityError.description.includes("sha256"), false);
});

test("channel entry keeps missing-device recovery visible and validates nickname in place", () => {
  const home = readRenderer("pages/HomePage.tsx");
  assert.match(home, /aria-invalid=\{Boolean\(nicknameValidationError\)\}/);
  assert.match(home, /nickname-error/);
  assert.match(home, /选择设备/);
  assert.match(home, /openSystemSettings\("microphone"\)/);
  assert.match(home, /openSystemSettings\("sound"\)/);
  assert.doesNotMatch(
    home,
    /disabled=\{[^}]*\(!hasMicrophonePermission \|\| !hasAudioInput \|\| !hasAudioOutput\)/,
  );
});

test("screen-source loading has explicit empty, failure, and retry states", () => {
  const overlays = readRenderer("components/room/RoomOverlays.tsx");
  const room = readRenderer("pages/RoomPage.tsx");
  assert.match(overlays, /status === "loading"/);
  assert.match(overlays, /status === "empty" \|\| status === "error"/);
  assert.match(overlays, /没有找到可分享的画面/);
  assert.match(overlays, /重新读取/);
  assert.match(overlays, /打开显示设置/);
  assert.match(room, /setScreenSourcePickerStatus\("empty"\)/);
  assert.match(room, /setScreenSourcePickerStatus\("error"\)/);
});

test("reconnect and detached viewer waits become actionable instead of blocking forever", () => {
  const reconnect = readRenderer("components/status/ReconnectOverlay.tsx");
  const viewer = readRenderer("pages/ScreenShareViewerPage.tsx");
  assert.match(reconnect, /RECONNECT_ACTION_DELAY_MS = 8_000/);
  assert.match(reconnect, /立即重试/);
  assert.match(reconnect, /返回首页/);
  assert.match(reconnect, /pointer-events-none fixed inset-x-0/);
  assert.doesNotMatch(reconnect, /fixed inset-0/);
  assert.match(viewer, /画面仍未到达/);
  assert.match(viewer, /重新连接/);
});

test("optional updates, long AI waits, and toasts all have a clear escape route", () => {
  const update = readRenderer("components/status/UpdateModal.tsx");
  const ask = readRenderer("components/room/RoomAskDialog.tsx");
  const toast = readRenderer("components/layout/ToastRegion.tsx");
  const appStore = readRenderer("store/appStore.ts");

  assert.match(update, /isForced/);
  assert.match(update, /DialogCloseButton label="稍后提醒"/);
  assert.match(update, /shanghao:dismissed-update-version/);
  assert.match(ask, /正在查找相关语音记忆/);
  assert.match(ask, /正在整理相关内容/);
  assert.match(ask, /正在生成回答/);
  assert.match(ask, /重新提问/);
  assert.match(toast, /toast.actionLabel && toast.onAction/);
  assert.match(toast, /aria-label="关闭提示"/);
  assert.match(appStore, /tone === "warning"[\s\S]*8_000[\s\S]*12_000/);
});

test("successful recordings use the shared compact notification instead of a modal", () => {
  const room = readRenderer("pages/RoomPage.tsx");
  const overlays = readRenderer("pages/SharedOverlays.tsx");

  assert.doesNotMatch(overlays, /RecordingSaveDialog/);
  assert.match(room, /title: "录音已保存"/);
  assert.match(room, /description: result\.filePath/);
  assert.doesNotMatch(room, /title: "录音已保存"[\s\S]{0,180}actionLabel/);
});

test("startup diagnostics remain available without covering the ordinary recovery copy", () => {
  const recovery = readRenderer("components/status/StartupRecoveryPage.tsx");
  assert.match(recovery, /<details/);
  assert.match(recovery, /技术详情/);
  assert.match(recovery, /重新加载/);
  assert.match(recovery, /安全模式/);
});
