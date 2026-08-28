import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { RELEASE_HISTORY } from "../src/renderer/src/components/status/releaseHistory";
import { QUICK_MESSAGE_PRESETS } from "@private-voice/shared";
import { readRendererCss } from "./helpers/read-renderer-css";

const audioCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AudioSettingsCard.tsx",
);
const settingsPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/SettingsPage.tsx");
const aboutSettingsPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AboutSettingsCard.tsx",
);
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
const modelTestPanelPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/ModelTestPanel.tsx",
);
const modelComparisonQueuePath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/ai/modelComparisonQueue.ts",
);
const aiVoiceMemoryCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AiVoiceMemorySettingsCard.tsx",
);
const quickMessageSettingsPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/QuickMessageSettingsCard.tsx",
);
const temporaryChatPanelPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/chat/TemporaryChatPanel.tsx",
);
const voiceMemoryDetailPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/VoiceMemoryDetail.tsx",
);
const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const appPath = path.resolve(process.cwd(), "src/renderer/src/app/App.tsx");
const ipcPath = path.resolve(process.cwd(), "src/main/ipc.ts");
const aiRuntimeManagerPath = path.resolve(process.cwd(), "src/main/ai-runtime-manager.ts");
const aiVoiceMemoryServicePath = path.resolve(process.cwd(), "src/main/ai-voice-memory-service.ts");
const asrRunnerPath = path.resolve(process.cwd(), "scripts/asr-runner.py");

test("semantic interface sounds have one simple master control without per-event switches", () => {
  const source = readFileSync(settingsPagePath, "utf8");
  const audioSource = readFileSync(audioCardPath, "utf8");

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
  assert.equal(audioSource.includes("界面音效"), true);
  assert.equal(audioSource.includes("isUiSoundEnabled"), true);
  assert.equal(audioSource.includes("soundVolume"), true);
  assert.equal(audioSource.includes('type="range"'), true);
  assert.equal(audioSource.includes('playUiSound("sound-preview")'), true);
});

test("quick messages use direct slot drops, a dense pack library, and compact shortcuts", () => {
  const source = readFileSync(quickMessageSettingsPath, "utf8");
  const chatSource = readFileSync(temporaryChatPanelPath, "utf8");

  assert.equal(source.includes("实时预览"), true);
  assert.equal(source.includes("musicPresetId"), true);
  assert.equal(source.includes("musicSlots"), true);
  assert.equal(source.includes("音乐快捷键"), true);
  assert.equal(source.includes("选择音乐快捷键"), true);
  assert.equal(source.includes("DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS"), true);
  assert.equal(source.includes("quick-message-music-preview"), true);
  assert.equal(source.includes("quick-message-music-preview-list"), true);
  assert.equal(source.includes("音乐（可添加 3 首）"), true);
  assert.equal(source.includes("onDrop={(event) => handleSlotDrop(event, index)}"), true);
  assert.equal(source.includes("draggable"), true);
  assert.equal(source.includes("快捷音频库"), true);
  assert.equal(source.includes('className="flex flex-wrap gap-2"'), true);
  assert.equal(source.includes("w-fit max-w-full cursor-grab"), true);
  assert.equal(source.includes("搜索音频名称或标签"), true);
  assert.equal(source.includes("libraryPresetCollator"), true);
  assert.equal(source.includes("leftMediaRank - rightMediaRank"), true);
  assert.equal(
    source.includes('const LIBRARY_MEDIA_FILTERS = ["全部", "语音", "音乐", "默认", "未分类"]'),
    true,
  );
  assert.equal(source.includes('aria-label="筛选音频类型"'), true);
  assert.equal(source.includes('aria-label="按游戏筛选音频"'), true);
  assert.equal(source.includes('aria-label="按主播筛选音频"'), true);
  assert.equal(source.includes("settings-inline-select"), true);
  assert.equal(source.includes("xl:grid-cols-5"), true);
  assert.equal(source.includes("快捷键"), true);
  assert.equal(source.includes("compact"), true);
  assert.equal(source.includes("soundVolume"), true);
  assert.equal(source.includes('"--ui-sound-volume"'), true);
  assert.equal(source.includes(">开关音效<"), true);
  assert.equal(source.includes("disabled={!settings.quickMessages.soundEnabled}"), true);
  const shortcutSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/base/ShortcutInput.tsx"),
    "utf8",
  );
  const styles = readRendererCss();
  assert.equal(shortcutSource.includes("shortcut-input-wrap-compact"), true);
  assert.equal(shortcutSource.includes("shortcut-input-field-compact"), true);
  assert.equal(shortcutSource.includes("pl-8 pr-1"), true);
  assert.equal(shortcutSource.includes("whitespace-nowrap"), true);
  assert.match(styles, /\.shortcut-input-wrap-compact\s*\{/);
  assert.match(styles, /\.shortcut-input-field-compact\s*\{/);
  assert.equal(source.includes("当前预览："), false);
  assert.equal(source.includes("添加到槽位"), false);
  assert.equal(source.includes("原有快捷回复"), false);
  assert.equal(source.includes("五个快捷键"), false);
  assert.equal(source.includes("以后可以按人物、游戏和来源继续分类"), false);
  assert.equal(
    source.includes('className="quick-message-filter-select settings-inline-select'),
    true,
  );
  assert.equal(source.includes(">全部游戏<"), true);
  assert.equal(source.includes(">全部主播<"), true);
  assert.equal(source.includes("librarySubfilterOptions"), false);
  assert.equal(source.includes("已添加 · 槽位"), true);
  assert.equal(source.includes("assignedSlotsByPreset"), true);
  assert.equal(source.includes("quick-message-filter-select"), true);
  assert.match(readRendererCss(), /\.quick-message-filter-select\s*\{/);
  assert.match(readRendererCss(), /\.chat-quick-music\s*\{/);
  assert.match(readRendererCss(), /\.quick-message-music-card\s*\{/);
  assert.equal(chatSource.includes("chat-quick-music"), true);
  assert.equal(chatSource.includes("chat-quick-music-row"), true);
  assert.equal(chatSource.includes('preset.mediaType === "music"'), true);
  assert.equal(source.includes("1/5"), false);
  assert.equal(source.includes(">聊天<"), false);
});

test("local voice pack keeps streamer and multi-game tags separate from display names", () => {
  assert.equal(
    QUICK_MESSAGE_PRESETS.some((preset) => preset.id === "legacy-ok"),
    false,
  );
  const localPresets = QUICK_MESSAGE_PRESETS.filter((preset) => preset.id.startsWith("voice-"));
  const pddPresets = localPresets.filter((preset) => preset.streamer === "PDD");

  assert.equal(localPresets.length, 28);
  assert.equal(pddPresets.length, 2);
  assert.deepEqual(pddPresets[0]?.gameTags, ["英雄联盟", "绝地求生"]);
  assert.equal(localPresets.find((preset) => preset.content === "nice")?.streamer, undefined);
  assert.equal(
    QUICK_MESSAGE_PRESETS.find((preset) => preset.id === "legacy-shanghao")?.streamer,
    "康康",
  );
  assert.deepEqual(
    QUICK_MESSAGE_PRESETS.find((preset) => preset.id === "legacy-shanghao")?.gameTags,
    ["瓦罗兰特"],
  );
  assert.deepEqual(localPresets.find((preset) => preset.content === "猛攻")?.gameTags, [
    "三角洲行动",
  ]);
  assert.equal(localPresets.find((preset) => preset.content === "吼大声")?.streamer, "孙笑川");
  assert.deepEqual(localPresets.find((preset) => preset.content === "吼大声")?.gameTags, [
    "英雄联盟",
  ]);
  assert.equal(localPresets.find((preset) => preset.content === "赋能哥？")?.streamer, "瓦瓦");
  assert.equal(
    localPresets.find((preset) => preset.content === "赋能哥？")?.gameTags?.[0],
    "无主契约",
  );
  const defaultVoicePresets = QUICK_MESSAGE_PRESETS.filter(
    (preset) => preset.category === "默认语音",
  );
  assert.equal(defaultVoicePresets.length, 6);
  assert.deepEqual(
    defaultVoicePresets.map((preset) => preset.content),
    ["开麦", "等我", "听得到吗", "上个厕所", "都哥们", "开"],
  );
  assert.equal(
    QUICK_MESSAGE_PRESETS.find((preset) => preset.id === "legacy-mic")?.soundId,
    "default-voice-开麦",
  );
  assert.equal(
    QUICK_MESSAGE_PRESETS.find((preset) => preset.id === "legacy-wait")?.soundId,
    "default-voice-等我",
  );
  assert.equal(
    QUICK_MESSAGE_PRESETS.find((preset) => preset.id === "legacy-hear")?.soundId,
    "default-voice-听得到吗",
  );
  assert.equal(readFileSync(quickMessageSettingsPath, "utf8").includes("导出音频包"), true);
});

test("weather settings expose the full dynamic scene without technical quality tiers", () => {
  const source = readFileSync(weatherSettingsPath, "utf8");
  const pickerSource = readFileSync(weatherCityPickerPath, "utf8");
  const styles = readRendererCss();
  assert.equal(source.includes("窗外动态天气"), true);
  assert.equal(source.includes("isDynamicWeatherEnabled"), true);
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
  assert.equal(source.includes("省资源"), false);
  assert.equal(source.includes("动态效果"), false);
  assert.equal(source.includes("API Key"), false);
  assert.equal(source.includes("latitude"), false);
  assert.equal(source.includes("longitude"), false);
});

test("interface scale stays automatic while the room overlay remains always on", () => {
  const source = readFileSync(settingsPagePath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");
  const appSource = readFileSync(appPath, "utf8");

  assert.equal(source.includes("界面大小"), false);
  assert.equal(source.includes("<option value={110}>110%</option>"), false);
  assert.equal(source.includes("<option value={125}>125%</option>"), false);
  assert.equal(source.includes("进入频道时显示悬浮窗"), false);
  assert.equal(source.includes("硬件加速"), false);
  assert.equal(roomSource.includes("isOverlayEnabled"), false);
  assert.equal(roomSource.includes("window.desktopApi.overlay.show()"), true);
  assert.equal(appSource.includes("settings?.uiScale"), false);
});

test("home page keeps the fixed channel server internal", () => {
  const source = readFileSync(homePagePath, "utf8");

  assert.equal(source.includes("服务器地址"), false);
  assert.equal(source.includes("进入频道"), true);
  assert.equal(source.includes("自动复制开房地址"), false);
  assert.equal(source.includes("连接模式"), false);
  assert.equal(source.includes("开启房间"), false);
});

test("audio settings keep only everyday controls", () => {
  const source = readFileSync(audioCardPath, "utf8");

  assert.equal(source.includes("高级音频"), false);
  assert.equal(source.includes("试音模式"), false);
  assert.equal(source.includes("micMonitorMode"), false);
  assert.equal(source.includes('value: "32000"'), false);
  assert.equal(source.includes("32 kHz"), false);
  assert.equal(source.includes("44.1 kHz"), false);
  assert.equal(source.includes("DeepFilterNet 固定使用 48 kHz"), false);
  assert.equal(source.includes("五段声音塑形"), false);
  assert.equal(source.includes("智能降噪"), false);
  assert.equal(source.includes("低频风噪抑制"), false);
  assert.equal(source.includes("ShortcutInput"), true);
  assert.equal(source.includes("pushToTalkShortcut"), true);
  assert.equal(source.includes("recordingMarkerShortcut"), true);
  assert.equal(source.includes('label="精彩时刻录制"'), true);
  assert.equal(source.includes("人声增强"), false);
  assert.equal(source.includes("isVoiceEnhancementEnabled"), false);
  assert.equal(source.includes("thresholdDraft"), false);
  assert.equal(source.includes("equalizerDraft"), false);
  assert.ok(source.indexOf("麦克风体检") > source.indexOf("preferredOutputDeviceId"));
  assert.ok(source.indexOf("麦克风体检") < source.indexOf("说话模式"));
});

test("settings keep only everyday voice controls and remove advanced connection", () => {
  const source = readFileSync(settingsPagePath, "utf8");
  const diagnosticsSource = readFileSync(diagnosticsCardPath, "utf8");

  for (const label of ["通用", "语音", "关于上号", "诊断"]) {
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
  assert.equal(source.includes("useState(() => {"), true);
  assert.equal(source.includes('if (!import.meta.env.DEV) return "general"'), true);
  for (const diagnostic of ["服务器连接", "网络速度", "房间连接", "Windows 网络权限"]) {
    assert.equal(diagnosticsSource.includes(diagnostic), true);
  }
  assert.equal(diagnosticsSource.includes("outputDeviceCount"), true);
  assert.equal(diagnosticsSource.includes("onOpenAudioSettings"), true);
  assert.equal(diagnosticsSource.includes("去语音设置"), true);
  assert.equal(diagnosticsSource.includes("需要看看"), true);
  assert.equal(diagnosticsSource.includes("未检测"), true);
  assert.equal(diagnosticsSource.includes("点击前往语音设置，检查输出设备和音量"), false);
  assert.equal(diagnosticsSource.includes("实时诊断 HUD"), false);
  assert.equal(diagnosticsSource.includes("技术参数"), false);
  assert.equal(diagnosticsSource.includes('connectionHealth.voicePath === "unknown"'), false);
  assert.equal(source.includes('onOpenAudioSettings={() => selectSection("audio")}'), true);
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

test("microphone processing lives in the room panel while about keeps release history complete", () => {
  const homeSource = readFileSync(homePagePath, "utf8");
  const roomDockSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomDock.tsx"),
    "utf8",
  );
  const settingsSource = readFileSync(settingsPagePath, "utf8");
  const aboutSource = readFileSync(aboutSettingsPath, "utf8");

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
  assert.equal(RELEASE_HISTORY.length, 74);
  assert.equal(RELEASE_HISTORY[0]?.version, "3.0.7");
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
  assert.equal(settingsSource.includes("AboutSettingsCard"), true);
  assert.equal(settingsSource.includes('{ id: "updates"'), false);
  assert.equal(aboutSource.includes("ReleaseDetailModal"), true);
  assert.equal(aboutSource.includes("slice(0, 10)"), false);
  assert.equal(aboutSource.includes("完整版本更新记录"), true);
  assert.equal(aboutSource.includes("检查更新"), true);
  assert.equal(aboutSource.includes("版本 {currentVersion}"), true);
  assert.equal(aboutSource.includes("作者主页"), true);
  assert.equal(aboutSource.includes("投喂作者"), true);
  assert.equal(aboutSource.includes("固定好友语音"), false);
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
  assert.equal(source.includes('aria-label="本次更新重点"'), true);
  assert.equal(source.includes("release-notes-highlight-list"), true);
  assert.equal(source.includes("release-notes-inline-emphasis"), true);
});

test("recording library safely cleans verified waste recordings", () => {
  const source = readFileSync(recordingLibraryCardPath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");
  const styles = readRendererCss();
  assert.equal(source.includes("window.desktopApi.recording.scanWaste()"), true);
  assert.equal(source.includes("录音占用"), true);
  assert.equal(source.includes("自动清理"), true);
  assert.equal(source.includes("上限"), true);
  assert.equal(source.includes("立即清理"), false);
  assert.equal(source.includes('                : "清理"'), true);
  assert.equal(source.includes("isRecordingWasteAutoCleanupEnabled"), true);
  assert.equal(source.includes("清理录音？"), true);
  assert.equal(source.includes("五分钟以下"), true);
  assert.equal(source.includes("收藏和带标记的录音不会被清理"), true);
  assert.equal(source.includes('role="alertdialog"'), true);
  assert.equal(source.includes("window.desktopApi.recording.deleteMany("), true);
  assert.equal(source.includes("showItemInFolder(item.filePath)"), true);
  assert.equal(source.includes("在文件夹中定位"), true);
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
  assert.match(styles, /\.recording-library-list\s*\{[^}]*grid-auto-rows:\s*max-content/s);
  assert.match(styles, /\.recording-library-list\s*\{[^}]*align-content:\s*start/s);
  assert.match(styles, /\.recording-library-panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(
    styles,
    /\.recording-library-panel::-webkit-scrollbar-thumb\s*\{[^}]*background-clip:\s*padding-box/s,
  );
  assert.match(styles, /\.recording-player-sticky\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.recording-rate-button\s*\{[^}]*font-size:\s*11px/s);
  assert.match(
    styles,
    /\.recording-playback-rate-button\s*\{[^}]*width:\s*58px;[^}]*min-width:\s*58px/s,
  );
  assert.equal(cardSource.includes('className="recording-player-sticky"'), true);
  assert.equal(cardSource.includes('className="recording-player-controls-row"'), true);
  assert.equal(cardSource.includes('aria-label="回到录音详情顶部"'), false);
  assert.equal(cardSource.includes("recordingPanelRef.current?.scrollTo({ top: 0 })"), false);
  assert.equal(cardSource.match(/录制时间/g)?.length, 2);
  assert.equal(
    cardSource.includes("已播 {formatTime(currentTime)} / 总时长 {formatTime(duration)}"),
    true,
  );
  assert.equal(cardSource.includes("safe / 3_600"), true);
  assert.equal(readFileSync(voiceMemoryDetailPath, "utf8").includes("hasMultipleSpeakers"), true);
  assert.equal(
    readFileSync(voiceMemoryDetailPath, "utf8").includes("转录模型 · {transcriptionModelLabel}"),
    true,
  );
  assert.equal(cardSource.includes("转录模型 · {memoryStatus.modelLabel}"), true);
  assert.match(styles, /\.voice-memory-model-badge\s*\{[^}]*text-overflow:\s*ellipsis/s);
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
  const asrRunnerSource = readFileSync(asrRunnerPath, "utf8");

  assert.equal(asrRunnerSource.includes('"qwen3-asr-1.7b-force"'), true);
  assert.equal(asrRunnerSource.includes('"fireredasr2-llm"'), false);
  assert.equal(asrRunnerSource.includes('"paraformer-zh"'), true);
  assert.equal(asrRunnerSource.includes('"moss-transcribe-diarize-0.9b"'), true);
  assert.equal(asrRunnerSource.includes('"dolphin-cn-dialect-0.4b"'), true);
  assert.equal(asrRunnerSource.includes('"cohere-transcribe-2b"'), true);
  assert.equal(asrRunnerSource.includes("parse_transcript"), true);
  assert.equal(asrRunnerSource.includes('dolphin.load_model("small.cn"'), true);
  assert.equal(asrRunnerSource.includes("waveform = torch.from_numpy(audio).unsqueeze(0)"), true);
  assert.equal(asrRunnerSource.includes("CohereAsrForConditionalGeneration"), true);
  assert.equal(asrRunnerSource.includes("self._ensure_aligner()"), true);
  assert.equal(
    asrRunnerSource.includes("ForcedAligner is only an optional timestamp enhancement"),
    true,
  );
  assert.equal(asrRunnerSource.includes("except Exception:"), true);
  assert.equal(asrRunnerSource.includes("use_half=True"), true);
  assert.equal(asrRunnerSource.includes("bf16=True"), true);
  assert.equal(asrRunnerSource.includes("do_sample=False"), true);
  assert.equal(asrRunnerSource.includes("staged_on_oom=True"), true);
  assert.equal(asrRunnerSource.includes("enable_legacy_distutils()"), true);
  assert.equal(runtimeSource.includes("vibeRuntime"), false);
  assert.equal(
    runtimeSource.includes("pythonPath: this.providerPythonPath(this.coherePythonPath)"),
    true,
  );
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
  const modelTestSource = readFileSync(modelTestPanelPath, "utf8");
  const modelComparisonQueueSource = readFileSync(modelComparisonQueuePath, "utf8");
  const styles = readRendererCss();
  assert.equal(source.includes("A. 概览"), true);
  assert.equal(source.includes("B. 转录模型与组件"), true);
  assert.equal(source.includes("B1. 主转录模型"), true);
  assert.equal(source.includes("B2. 共享组件"), true);
  assert.equal(source.includes("B3. 整理模型"), true);
  assert.equal(source.includes("C. 转录行为"), true);
  assert.equal(source.includes('className="ai-model-select-hit"'), true);
  assert.equal(source.includes("ai-asr-choice-grid"), false);
  assert.equal(source.includes("D. AI 整理与房间问答"), true);
  assert.equal(source.includes("下载模型"), true);
  assert.equal(source.includes('model.category === "asr"'), true);
  assert.equal(source.includes("modelSort"), false);
  assert.equal(source.includes("Keep the manifest order stable"), true);
  assert.match(styles, /\.ai-model-management-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/s);
  assert.equal(source.includes("runtimeStatus?.vibevoice"), false);
  assert.equal(source.includes('typeof aiApi.getRuntimeStatus !== "function"'), true);
  assert.equal(source.includes("model.id === settings.aiAsrModel"), true);
  assert.equal(source.includes("qwen3-forced-aligner-0.6b"), true);
  assert.equal(source.includes("isDisabled={!selectedAsrReady}"), true);
  assert.equal(source.includes("isDisabled={!organizerReady || !selectedAsrReady}"), true);
  assert.equal(source.includes('option value="cloud">房间云端（默认）'), true);
  assert.equal(source.includes("云端 API · 无需本地模型"), true);
  assert.equal(source.includes("providerSelect(settings.aiRoomAskProvider"), false);
  assert.equal(source.includes("无需安装任何本地问答模型"), true);
  assert.equal(source.includes("密钥由 Windows 加密后只保存在本机"), true);
  assert.equal(source.includes('value="after_game"'), true);
  assert.equal(source.includes("游戏中已降速"), true);
  assert.equal(source.includes("AI 处理状态"), false);
  assert.equal(source.includes("技术信息（排错时使用）"), false);
  const diagnosticsSource = readFileSync(diagnosticsCardPath, "utf8");
  assert.equal(diagnosticsSource.includes("AI 转录"), true);
  assert.equal(diagnosticsSource.includes("去 AI 设置"), true);
  assert.equal(diagnosticsSource.includes("AI 运行诊断"), false);
  assert.equal(diagnosticsSource.includes("技术参数"), false);
  assert.equal(diagnosticsSource.includes("模型位置"), false);
  assert.equal(diagnosticsSource.includes("任务编号"), false);
  assert.equal(diagnosticsSource.includes("原始错误"), false);
  assert.equal(source.includes("AI Runtime Diagnostics"), false);
  assert.equal(source.includes("ASR Model:"), false);
  assert.equal(source.includes("Recent task:"), false);
  assert.equal(settingsSource.includes('{ id: "ai", label: "AI 功能"'), true);
  assert.equal(settingsSource.includes("<AiVoiceMemorySettingsCard"), true);
  assert.equal(recordingSource.includes("AiVoiceMemorySettingsCard"), false);
  assert.equal(recordingSource.includes("listVoiceMemories"), true);
  assert.equal(modelTestSource.includes("modelSelectionStorageKey"), true);
  assert.equal(modelTestSource.includes("modelComparisonQueue"), true);
  assert.equal(modelTestSource.includes("onClose();"), true);
  assert.equal(modelTestSource.includes("继续剩余测试"), true);
  assert.equal(modelComparisonQueueSource.includes("localStorage"), true);
  assert.equal(modelComparisonQueueSource.includes("recording-model-comparison-run"), true);
  assert.equal(modelComparisonQueueSource.includes("createComparisonTaskId"), true);
  assert.equal(modelComparisonQueueSource.includes("taskMatches(accepted, taskId)"), true);
  assert.equal(modelComparisonQueueSource.includes("isRetryableFailure"), true);
  assert.equal(modelComparisonQueueSource.includes("window.setInterval(poll, 1_000)"), true);
  assert.equal(modelTestSource.includes("重新测试${modelDisplayName(modelId)}"), true);
  assert.equal(recordingSource.includes("setIsModelComparisonOpen(false)"), true);
  assert.equal(recordingSource.includes("key={selected.recordingId}"), true);
  assert.match(styles, /\.model-comparison-rerun\s*\{/);
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
