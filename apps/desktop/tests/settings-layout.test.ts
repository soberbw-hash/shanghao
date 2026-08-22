import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { RELEASE_HISTORY } from "../src/renderer/src/components/status/releaseHistory";
import { readRendererCss } from "./helpers/read-renderer-css";

const audioCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AudioSettingsCard.tsx",
);
const settingsPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/SettingsPage.tsx");
const settingsPageHeaderPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/SettingsPageHeader.tsx",
);
const weatherSettingsPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/WeatherSettingsCard.tsx",
);
const weatherCityPickerPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/WeatherCityPicker.tsx",
);
const homePagePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
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
const voiceMemoryDetailPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/VoiceMemoryDetail.tsx",
);
const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const ipcPath = path.resolve(process.cwd(), "src/main/ipc.ts");
const aiRuntimeManagerPath = path.resolve(process.cwd(), "src/main/ai-runtime-manager.ts");
const aiVoiceMemoryServicePath = path.resolve(process.cwd(), "src/main/ai-voice-memory-service.ts");
const vibeVoiceRuntimePath = path.resolve(process.cwd(), "src/main/vibevoice-runtime.ts");

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

test("weather settings stay lightweight and hide technical provider details", () => {
  const source = readFileSync(weatherSettingsPath, "utf8");
  const pickerSource = readFileSync(weatherCityPickerPath, "utf8");
  const styles = readRendererCss();
  assert.equal(source.includes("窗外天气"), true);
  assert.equal(source.includes("天气位置"), true);
  assert.equal(source.includes("Windows 系统定位"), true);
  assert.equal(source.includes("公网 IP 自动定位"), false);
  assert.equal(source.includes("手动天气城市"), false);
  assert.equal(source.includes("WeatherCityPicker"), true);
  assert.equal(pickerSource.includes("<dialog"), true);
  assert.equal(pickerSource.includes("showModal()"), true);
  assert.equal(pickerSource.includes('type="search"'), true);
  assert.equal(pickerSource.includes('aria-label="搜索城市或输入地点"'), true);
  assert.equal(pickerSource.includes("热门城市"), true);
  assert.equal(pickerSource.includes("更多县市"), false);
  assert.equal(pickerSource.includes("使用“{normalizedQuery}”"), true);
  assert.equal(pickerSource.includes("恢复自动定位"), true);
  assert.equal(pickerSource.includes("<datalist"), false);
  assert.match(
    styles,
    /\.weather-city-dialog\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*margin:\s*auto;/s,
  );
  assert.match(styles, /\.weather-city-dialog-results\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.equal(source.includes("省资源"), true);
  assert.equal(source.includes("API Key"), false);
  assert.equal(source.includes("latitude"), false);
  assert.equal(source.includes("longitude"), false);
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
  assert.equal(source.includes('useState<SettingsSectionId>("general")'), true);
  for (const diagnostic of ["Relay 延迟", "TURN", "WebRTC", "当前语音路径", "丢包", "抖动"]) {
    assert.equal(diagnosticsSource.includes(diagnostic), true);
  }
});

test("settings pages keep the shared header compact", () => {
  const source = readFileSync(settingsPagePath, "utf8");
  const headerSource = readFileSync(settingsPageHeaderPath, "utf8");
  const styles = readRendererCss();

  assert.equal(source.includes("saveNotice={saveNotice}"), true);
  assert.equal(source.includes("mt-2 grid gap-5"), true);
  assert.equal(source.includes("mb-2 text-right text-xs"), false);
  assert.equal(source.includes('"settings-page-shell"'), true);
  assert.equal(source.includes('? "settings-recording-shell" : "contents"'), false);
  assert.equal(headerSource.includes('className="settings-save-notice"'), true);
  assert.match(styles, /\.settings-page-header\s*\{[^}]*min-height:\s*48px;/s);
  assert.match(styles, /\.settings-page-header-actions\s*\{[^}]*display:\s*flex;/s);
  assert.match(styles, /\.settings-page-shell\s*\{[^}]*display:\s*flex;/s);
});

test("microphone processing lives in the room panel while release history remains complete", () => {
  const homeSource = readFileSync(homePagePath, "utf8");
  const roomDockSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomDock.tsx"),
    "utf8",
  );
  const settingsSource = readFileSync(settingsPagePath, "utf8");

  assert.equal(homeSource.includes("自动增益"), false);
  assert.equal(homeSource.includes('from "../components/base/Switch"'), false);
  assert.equal(homeSource.includes("entry-mic-menu"), true);
  assert.equal(
    roomDockSource.includes("autoGainEnabled={settings.isAutoGainControlEnabled}"),
    true,
  );
  assert.equal(
    roomDockSource.includes("echoCancellationEnabled={settings.isEchoCancellationEnabled}"),
    true,
  );
  assert.equal(
    roomDockSource.includes("voiceEnhancementEnabled={settings.isVoiceEnhancementEnabled}"),
    true,
  );
  assert.equal(roomDockSource.includes("voice-segmented-arrow"), true);
  const audioCardSource = readFileSync(audioCardPath, "utf8");
  assert.equal(audioCardSource.includes("isAutoGainControlEnabled"), false);
  assert.equal(audioCardSource.includes("isFriendLoudnessBalanceEnabled"), false);
  assert.equal(roomDockSource.includes("settings.isFriendLoudnessBalanceEnabled"), true);
  assert.equal(RELEASE_HISTORY.length, 69);
  assert.equal(RELEASE_HISTORY[0]?.version, "3.0.2");
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
  assert.equal(source.includes("暂无本地记录，进入一次房间后会自动同步"), true);
  assert.equal(source.includes("当前显示本地记录，服务器暂时无法刷新"), true);
  assert.equal(source.includes("useDailyRoomReportStore.getState().hydrate()"), true);
  assert.equal(source.includes("formatParticipantNames(report)"), true);
  assert.equal(source.includes("来过：{participantNames}"), true);
});

test("release notes emphasize only the leading keyword", () => {
  const source = readFileSync(detailedReleaseNotesPath, "utf8");
  assert.equal(source.includes('className="release-notes-detail-keyword"'), true);
  assert.equal(source.includes('item.indexOf("：")'), true);
});

test("recording library safely cleans verified waste recordings", () => {
  const source = readFileSync(recordingLibraryCardPath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");
  const styles = readRendererCss();
  assert.equal(source.includes("window.desktopApi.recording.scanWaste()"), true);
  assert.equal(source.includes("录音占用"), true);
  assert.equal(source.includes("自动清理"), true);
  assert.equal(source.includes("上限"), true);
  assert.equal(source.includes("立即清理"), true);
  assert.equal(source.includes("isRecordingWasteAutoCleanupEnabled"), true);
  assert.equal(source.includes("清理录音？"), true);
  assert.equal(source.includes("五分钟以下"), true);
  assert.equal(source.includes("收藏和带标记的录音不会被清理"), true);
  assert.equal(source.includes('role="alertdialog"'), true);
  assert.equal(source.includes("window.desktopApi.recording.deleteMany("), true);
  assert.equal(source.includes("onScanWasteProgress"), true);
  assert.equal(source.includes("cleanupScanProgress.processed"), true);
  assert.equal(source.includes('className="recording-library-utility-bar"'), true);
  assert.equal(source.includes('from "./SettingsItemRow"'), false);
  assert.match(styles, /\.recording-library-utility-bar\s*\{[^}]*display:\s*flex;/s);
  assert.match(
    styles,
    /\.recording-library-page > \.settings-section-card \.settings-section-heading\s*\{[^}]*flex-direction:\s*row/s,
  );
  assert.ok(
    roomSource.indexOf("saveMarkers(result.filePath, markers)") <
      roomSource.indexOf("applyAutomaticCleanup(result.filePath)"),
  );
});

test("recording library supports accessible multi-selection and confirmed batch deletion", () => {
  const source = readFileSync(recordingLibraryCardPath, "utf8");
  assert.equal(source.includes("isSelectionMode"), true);
  assert.equal(source.includes("selectedRecordingIds"), true);
  assert.equal(source.includes("toggleSelectAllVisible"), true);
  assert.equal(source.includes("删除选中的"), true);
  assert.equal(source.includes("转录内容和对应的本地语音记忆会一起删除"), true);
  assert.equal(source.includes("aria-pressed={selectedRecordingIds.has(item.id)}"), true);
});

test("recording library keeps both desktop columns useful while browsing long lists", () => {
  const cardSource = readFileSync(recordingLibraryCardPath, "utf8");
  const settingsSource = readFileSync(settingsPagePath, "utf8");
  const styles = readRendererCss();

  assert.equal(cardSource.includes('className="recording-library-page"'), true);
  assert.equal(settingsSource.includes("settings-page--recording-library overflow-hidden"), true);
  assert.equal(settingsSource.includes("settings-recording-content"), true);
  assert.match(
    styles,
    /\.recording-library-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(340px, 390px\) minmax\(0, 1fr\)/s,
  );
  assert.match(styles, /\.recording-library-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.recording-library-panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(
    styles,
    /\.recording-library-panel::-webkit-scrollbar-thumb\s*\{[^}]*background-clip:\s*padding-box/s,
  );
  assert.match(styles, /\.recording-player-sticky\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.recording-rate-button\s*\{[^}]*font-size:\s*11px/s);
  assert.equal(cardSource.includes('className="recording-player-sticky"'), true);
  assert.equal(cardSource.includes('className="recording-player-controls-row"'), true);
  assert.equal(cardSource.includes('aria-label="回到录音详情顶部"'), true);
  assert.equal(cardSource.includes("recordingPanelRef.current?.scrollTo({ top: 0 })"), true);
  assert.equal(cardSource.match(/录制时间/g)?.length, 2);
  assert.equal(
    cardSource.includes("已播 {formatTime(currentTime)} / 总时长 {formatTime(duration)}"),
    true,
  );
  assert.equal(cardSource.includes("safe / 3_600"), true);
  assert.equal(readFileSync(voiceMemoryDetailPath, "utf8").includes("hasMultipleSpeakers"), true);
  assert.doesNotMatch(styles, /\.voice-memory-transcript\s*\{[^}]*overflow:\s*auto/s);
  assert.equal(cardSource.includes('["main", "一号房"]'), false);
  assert.equal(cardSource.includes('["side", "二号房"]'), false);
  assert.equal(cardSource.includes("`语音 ${String(recordingNumbers.get(item.id)"), true);
});

test("recording library paints before deferred transcript status hydration", () => {
  const cardSource = readFileSync(recordingLibraryCardPath, "utf8");
  const settingsSource = readFileSync(settingsPagePath, "utf8");
  const ipcSource = readFileSync(ipcPath, "utf8");
  const listHandler = ipcSource.slice(
    ipcSource.indexOf("IPC_CHANNELS.recording.list"),
    ipcSource.indexOf("IPC_CHANNELS.recording.scanWaste"),
  );

  assert.equal(cardSource.includes("const RECORDING_RENDER_BATCH = 24"), true);
  assert.equal(cardSource.includes("recording-library-loading"), true);
  assert.equal(cardSource.includes("requestIdleCallback"), true);
  assert.equal(settingsSource.includes("{ autoAlpha: 0, x: 10 }"), false);
  assert.equal(listHandler.includes("reconcileRecordingIdentity"), false);
});

test("successful empty ASR units remain silence instead of failing the recording", () => {
  const runtimeSource = readFileSync(aiRuntimeManagerPath, "utf8");
  const voiceMemorySource = readFileSync(aiVoiceMemoryServicePath, "utf8");
  const vibeSource = readFileSync(vibeVoiceRuntimePath, "utf8");

  assert.equal(runtimeSource.includes("if (!rawOutput) return [];"), true);
  assert.equal(runtimeSource.includes("vibevoice_empty_output"), false);
  assert.equal(vibeSource.includes("Mandarin Chinese voice chat"), false);
  assert.equal(vibeSource.includes('"--greedy"'), false);
  assert.equal(vibeSource.includes('resourceMode === "low" ? 4'), true);
  assert.equal(runtimeSource.includes("timeoutMs: options.timeoutMs ?? 4 * 60_000"), true);
  assert.equal(voiceMemorySource.includes("maxNewTokens: 384"), true);
  assert.equal(voiceMemorySource.includes("transcriptForPrompt(record, 6_000)"), true);
  assert.equal(voiceMemorySource.includes("normalizeOrganizedResult(result, record)"), true);
  assert.equal(voiceMemorySource.includes("四个字段必须始终是数组"), true);
  const detailSource = readFileSync(voiceMemoryDetailPath, "utf8");
  assert.equal(detailSource.includes("qwen_worker_timeout"), true);
  assert.equal(detailSource.includes('process("transcribe")'), true);
  assert.equal(detailSource.includes('process("organize")'), true);
  assert.equal(detailSource.includes('transcribe: action === "transcribe"'), true);
  assert.equal(detailSource.includes('organize: action === "organize"'), true);
  assert.equal(detailSource.includes("diagnostic?.taskId"), false);
});

test("AI voice memory keeps first install manual and disables unavailable automation", () => {
  const source = readFileSync(aiVoiceMemoryCardPath, "utf8");
  const settingsSource = readFileSync(settingsPagePath, "utf8");
  const recordingSource = readFileSync(recordingLibraryCardPath, "utf8");
  assert.equal(source.includes("首次使用由你手动下载"), true);
  assert.equal(source.includes("下载模型"), true);
  assert.equal(source.includes('model.category === "asr" || model.id !== "qwen35-4b"'), true);
  assert.equal(source.includes("runtimeStatus?.asr ?? runtimeStatus?.vibevoice"), true);
  assert.equal(source.includes('typeof aiApi.getRuntimeStatus !== "function"'), true);
  assert.equal(source.includes("model.id === settings.aiAsrModel"), true);
  assert.equal(source.includes("isDisabled={!selectedAsrReady}"), true);
  assert.equal(source.includes("isDisabled={!qwenInstalled || !selectedAsrReady}"), true);
  assert.equal(source.includes('value="after_game"'), true);
  assert.equal(source.includes("游戏中已降速"), true);
  assert.equal(source.includes("import.meta.env.DEV"), true);
  assert.equal(source.includes("AI 处理状态"), true);
  assert.equal(source.includes("最近处理的录音"), true);
  assert.equal(source.includes("处理进度"), true);
  assert.equal(source.includes("技术信息（排错时使用）"), true);
  assert.equal(source.includes("AI Runtime Diagnostics"), false);
  assert.equal(source.includes("ASR Model:"), false);
  assert.equal(source.includes("Recent task:"), false);
  assert.equal(settingsSource.includes('{ id: "ai", label: "AI 功能"'), true);
  assert.equal(settingsSource.includes("<AiVoiceMemorySettingsCard"), true);
  assert.equal(recordingSource.includes("AiVoiceMemorySettingsCard"), false);
  assert.equal(recordingSource.includes("listVoiceMemories"), true);
  assert.equal(recordingSource.includes("转录中 ${progress}%"), true);
  assert.equal(recordingSource.includes("recording-item-ai-progress"), true);
  assert.equal(recordingSource.includes("transcriptionSummary"), false);
  assert.equal(source.includes("语音记忆搜索"), false);
  assert.equal(readFileSync(voiceMemoryDetailPath, "utf8").includes("问问这条录音"), false);
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
