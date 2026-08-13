import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { RELEASE_HISTORY } from "../src/renderer/src/components/status/releaseHistory";

const audioCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AudioSettingsCard.tsx",
);
const settingsPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/SettingsPage.tsx");
const homePagePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const diagnosticsCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/DiagnosticsSettingsCard.tsx",
);
const roomHistoryCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/RoomHistorySettingsCard.tsx",
);
const detailedReleaseNotesPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/status/DetailedReleaseNotesViewer.tsx",
);
const recordingLibraryCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/RecordingLibrarySettingsCard.tsx",
);
const aiVoiceMemoryCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AiVoiceMemorySettingsCard.tsx",
);

test("fixed sounds, game detection, and system notifications stay out of settings", () => {
  const source = readFileSync(settingsPagePath, "utf8");

  assert.equal(source.includes("开麦提示音"), false);
  assert.equal(source.includes("关麦提示音"), false);
  assert.equal(source.includes("成员进入提示音"), false);
  assert.equal(source.includes("成员退出提示音"), false);
  assert.equal(source.includes("连接成功"), false);
  assert.equal(source.includes("界面提示音"), false);
  assert.equal(source.includes("提示音音量"), false);
  assert.equal(source.includes("自动识别游戏"), false);
  assert.equal(source.includes("系统通知"), false);
  assert.equal(source.includes("关闭窗口时留在后台"), true);
});

test("home page exposes only the fixed channel server address entry", () => {
  const source = readFileSync(homePagePath, "utf8");

  assert.equal(source.includes("服务器地址"), true);
  assert.equal(source.includes("进入频道"), true);
  assert.equal(source.includes("自动复制开房地址"), false);
  assert.equal(source.includes("连接模式"), false);
  assert.equal(source.includes("开启房间"), false);
});

test("advanced audio settings are collapsed by default", () => {
  const source = readFileSync(audioCardPath, "utf8");

  assert.equal(source.includes("高级音频"), true);
  assert.equal(source.includes("一般不需要修改"), true);
  assert.equal(source.includes("isAdvancedOpen ?"), true);
  assert.equal(source.includes('value: "32000"'), false);
  assert.equal(source.includes("32 kHz"), false);
  assert.equal(source.includes("44.1 kHz"), false);
  assert.equal(source.includes("DeepFilterNet 固定使用 48 kHz"), false);
  assert.equal(source.includes("五段声音塑形"), true);
  assert.equal(source.includes("智能降噪"), false);
  assert.equal(source.includes("低频风噪抑制"), true);
  assert.equal(source.includes("人声增强"), false);
  assert.equal(source.includes("isVoiceEnhancementEnabled"), false);
  assert.equal(source.includes("thresholdDraft"), false);
  assert.equal(source.includes("equalizerDraft"), true);
});

test("settings keep only everyday voice controls and remove advanced connection", () => {
  const source = readFileSync(settingsPagePath, "utf8");
  const diagnosticsSource = readFileSync(diagnosticsCardPath, "utf8");

  for (const label of ["通用", "语音", "更新", "诊断"]) {
    assert.equal(source.includes(label), true);
  }
  assert.equal(source.includes('{ id: "notifications"'), false);
  assert.equal(source.includes('id: "recording"'), false);
  for (const removed of [
    "资料",
    "悬浮小窗",
    "高级连接",
    "NetworkSettingsCard",
    "ProfileSettingsCard",
  ]) {
    assert.equal(source.includes(removed), false);
  }
  assert.equal(source.includes('useState<SettingsSectionId>("audio")'), true);
  for (const diagnostic of ["Relay 延迟", "TURN", "WebRTC", "当前语音路径", "丢包", "抖动"]) {
    assert.equal(diagnosticsSource.includes(diagnostic), true);
  }
});

test("microphone processing lives in the room panel while release history remains complete", () => {
  const homeSource = readFileSync(homePagePath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");
  const settingsSource = readFileSync(settingsPagePath, "utf8");

  assert.equal(homeSource.includes("自动增益"), false);
  assert.equal(homeSource.includes('from "../components/base/Switch"'), false);
  assert.equal(homeSource.includes("entry-mic-menu"), true);
  assert.equal(roomSource.includes("autoGainEnabled={settings.isAutoGainControlEnabled}"), true);
  assert.equal(
    roomSource.includes("echoCancellationEnabled={settings.isEchoCancellationEnabled}"),
    true,
  );
  assert.equal(
    roomSource.includes("voiceEnhancementEnabled={settings.isVoiceEnhancementEnabled}"),
    true,
  );
  assert.equal(roomSource.includes("voice-segmented-arrow"), true);
  assert.equal(readFileSync(audioCardPath, "utf8").includes("isAutoGainControlEnabled"), false);
  assert.equal(RELEASE_HISTORY.length, 64);
  assert.equal(RELEASE_HISTORY[0]?.version, "2.8.0");
  assert.equal(RELEASE_HISTORY.at(-1)?.version, "0.1.1");
  assert.equal(
    new Set(RELEASE_HISTORY.map((release) => release.version)).size,
    RELEASE_HISTORY.length,
  );
  assert.equal(
    RELEASE_HISTORY.every(
      (release, index) =>
        index === 0 || Date.parse(RELEASE_HISTORY[index - 1]!.date) >= Date.parse(release.date),
    ),
    true,
  );
  assert.equal(
    RELEASE_HISTORY.every((release) => release.details.length > 0),
    true,
  );
  assert.equal(settingsSource.includes("查看详细信息"), true);
  assert.equal(settingsSource.includes("查看每一项具体改动"), false);
  assert.equal(settingsSource.includes("ReleaseDetailModal"), true);
  assert.equal(settingsSource.includes("slice(0, 10)"), false);
  assert.equal(settingsSource.includes("完整版本更新记录"), true);
});

test("room history leaves loading state on legacy servers", () => {
  const source = readFileSync(roomHistoryCardPath, "utf8");
  assert.equal(source.includes("当前服务器暂不支持房间记录"), true);
  assert.equal(source.includes("暂无房间记录"), true);
  assert.equal(source.includes("formatParticipantNames(report)"), true);
  assert.equal(source.includes("来过：{participantNames}"), true);
});

test("release notes emphasize only the leading keyword", () => {
  const source = readFileSync(detailedReleaseNotesPath, "utf8");
  assert.equal(source.includes('className="release-notes-detail-keyword"'), true);
  assert.equal(source.includes('item.indexOf("：")'), true);
});

test("recording library can clean recordings shorter than ten seconds", () => {
  const source = readFileSync(recordingLibraryCardPath, "utf8");
  assert.equal(source.includes("SHORT_RECORDING_SECONDS = 10"), true);
  assert.equal(source.includes("清理短录音"), true);
  assert.equal(source.includes('role="alertdialog"'), true);
  assert.equal(source.includes("window.desktopApi.recording.delete(item.filePath)"), true);
});

test("AI voice memory keeps first install manual and disables unavailable automation", () => {
  const source = readFileSync(aiVoiceMemoryCardPath, "utf8");
  const settingsSource = readFileSync(settingsPagePath, "utf8");
  const recordingSource = readFileSync(recordingLibraryCardPath, "utf8");
  assert.equal(source.includes("首次使用由你手动下载"), true);
  assert.equal(source.includes("下载模型"), true);
  assert.equal(source.includes("isDisabled={!vibeInstalled}"), true);
  assert.equal(source.includes("isDisabled={!qwenInstalled || !vibeInstalled}"), true);
  assert.equal(source.includes('value="after_game"'), true);
  assert.equal(source.includes("游戏中已降速"), true);
  assert.equal(settingsSource.includes('{ id: "ai", label: "AI 功能"'), true);
  assert.equal(settingsSource.includes("<AiVoiceMemorySettingsCard"), true);
  assert.equal(recordingSource.includes("AiVoiceMemorySettingsCard"), false);
});

test("desktop icon overlay controls wait for the real Windows state", () => {
  const source = readFileSync(settingsPagePath, "utf8");

  assert.equal(source.includes("cachedWindowsDiagnostics = snapshot"), true);
  assert.equal(
    source.includes("isWindowsDiagnosticsLoading || windowsDiagnostics?.iconOverlays.hidden"),
    true,
  );
  assert.equal(source.includes('{isWindowsDiagnosticsLoading ? "读取状态…" : "一键隐藏"}'), true);
});
