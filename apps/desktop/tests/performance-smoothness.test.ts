import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  cacheSettingsSection,
  type SettingsSectionId,
} from "../src/renderer/src/features/settings/settingsSectionState";

const read = (relativePath: string) =>
  readFileSync(path.resolve(process.cwd(), "src/renderer/src", relativePath), "utf8");

test("development performance HUD stays behind the dev guard without React profiling wrappers", () => {
  const app = read("app/App.tsx");

  assert.equal(app.includes("InteractionPerformanceHud"), true);
  assert.equal(
    app.includes("import.meta.env.DEV ? <InteractionPerformanceHud route={currentPage} /> : null"),
    true,
  );
  assert.equal(app.includes("<Profiler"), false);
  assert.equal(app.includes("recordReactCommit"), false);
});

test("settings keep lightweight pages warm and unload hidden heavy work", () => {
  const app = read("app/App.tsx");
  const settings = read("pages/SettingsPage.tsx");
  const settingsState = read("features/settings/settingsSectionState.ts");
  const room = read("pages/RoomPage.tsx");
  const shellStyles = read("styles/parts/20-activity-shell.css");
  const recordings = read("components/settings/RecordingLibrarySettingsCard.tsx");
  const ai = read("components/settings/AiVoiceMemorySettingsCard.tsx");

  assert.equal(app.includes("hasOpenedSettings"), true);
  assert.equal(app.includes("<SettingsPage isActive={isSettingsOpen} />"), true);
  assert.equal(settings.includes("visitedSections.has(id)"), true);
  assert.equal(settings.includes("hidden={!isCurrentSection}"), true);
  assert.equal(settingsState.includes("lightweightSections"), true);
  assert.equal(settings.includes("MAX_CACHED_SETTINGS_SECTIONS"), false);
  assert.equal(settings.includes("SETTINGS_PREWARM_ORDER"), false);
  assert.equal(settings.includes("Promise.allSettled"), false);
  assert.equal(settings.includes("mountHeavySection"), false);
  assert.equal(settings.includes("sectionDirectionRef"), false);
  assert.equal(settings.includes("settingsSectionSignature"), true);
  assert.equal(settingsState.includes("readRequestedSettingsSection"), true);
  assert.equal(settings.includes("useMicTest"), false);
  assert.equal(room.includes("const micTest = useMicTest({"), true);
  assert.equal(recordings.includes("if (!isActive) return;"), true);
  assert.equal(recordings.includes("audioRef.current?.pause()"), true);
  assert.equal(ai.includes("if (!isActive) return;"), true);
  assert.equal(ai.includes("window.setInterval(refresh, 2_000)"), false);
  assert.equal(shellStyles.includes("transition-behavior: allow-discrete"), true);
});

test("the 49-switch settings stress sequence keeps mounted section count bounded", () => {
  const sections: SettingsSectionId[] = [
    "general",
    "audio",
    "quickMessages",
    "ai",
    "recordings",
    "account",
    "about",
  ];
  let cached = new Set<SettingsSectionId>(["general"]);
  let maxMounted = cached.size;
  for (const section of Array.from({ length: 7 }, () => sections).flat()) {
    cached = cacheSettingsSection(cached, section);
    maxMounted = Math.max(maxMounted, cached.size);
  }
  assert.equal(maxMounted, 6);
  assert.deepEqual([...cached], ["general", "audio", "quickMessages", "account", "about"]);
});

test("high-frequency chat, telemetry, and pressure paths avoid broad invalidation", () => {
  const room = read("pages/RoomPage.tsx");
  const chat = read("components/chat/TemporaryChatPanel.tsx");
  const store = read("store/roomStore.ts");

  assert.equal(room.includes("runtimePressureRef.current"), true);
  assert.equal(room.includes("}, [room.connectionState, recordingStatus.state]);"), true);
  assert.equal(room.includes("<RoomChatPanel"), true);
  assert.equal(chat.includes("latestMessageElementRef"), true);
  assert.equal(chat.includes("isNearBottomRef"), true);
  assert.equal(chat.includes('querySelectorAll("[data-gsap-chat-message]")'), false);
  assert.equal(store.includes("hasSameVisibleConnectionHealth"), true);
  assert.equal(store.includes("const canAppend ="), true);
});

test("AI runtime discovery batches model status updates", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/main/ai-voice-memory-service.ts"),
    "utf8",
  );

  assert.equal(source.includes("batchRuntimeStatuses(statuses)"), true);
  assert.equal(source.includes("this.models.setRuntimeStatus(id as AiModelId"), false);
});

test("room entry waits for signaling while chat image decode uses visible loading feedback", () => {
  const roomState = read("hooks/useRoomState.ts");
  const lightbox = read("components/chat/ChatImageLightbox.tsx");
  const chat = read("components/chat/TemporaryChatPanel.tsx");
  const preload = read("features/chat/chatImagePreload.ts");

  const navigateIndex = roomState.indexOf('navigate("room")');
  const connectIndex = roomState.indexOf("await connectToFixedChannel");
  assert.equal(connectIndex >= 0 && navigateIndex > connectIndex, true);
  assert.equal(roomState.includes("const chatHistoryPromise"), true);
  assert.equal(lightbox.includes("await imageElement.decode()"), false);
  assert.equal(lightbox.includes("chat-image-preview-loading"), true);
  assert.equal(lightbox.includes("markImageReady"), true);
  assert.equal(lightbox.includes("setReadyImageUrl"), true);
  assert.equal(chat.includes("onPointerEnter"), true);
  assert.equal(chat.includes("onPointerDown"), true);
  assert.equal(preload.includes("MAX_PRELOADED_CHAT_IMAGES = 12"), true);
});

test("audio menus retain only panels that have actually been opened", () => {
  const dock = read("components/room/RoomDock.tsx");
  const popover = read("components/audio/AudioControlPopover.tsx");
  const styles = read("styles/parts/110-component-polish.css");
  const sensoryStyles = read("styles/parts/160-sensory-polish.css");

  assert.equal(dock.includes("mountedAudioPanels"), true);
  assert.equal(dock.includes("toggleAudioPanel"), true);
  assert.equal(dock.includes("<AnimatePresence>"), false);
  assert.equal(popover.includes('animate={isOpen ? "open" : "closed"}'), true);
  assert.equal(popover.includes("interactionPerformanceMonitor"), false);
  assert.equal(styles.includes('.audio-control-popover[aria-hidden="false"]'), true);
  assert.match(
    sensoryStyles,
    /\.room-page \.audio-control-popover\s*\{[^}]*backdrop-filter:\s*none !important/s,
  );
});

test("model comparison watchdog follows durable heartbeats and allows slow local inference", () => {
  const queue = read("features/ai/modelComparisonQueue.ts");

  assert.equal(queue.includes("const COMPARISON_WATCHDOG_MS = 30 * 60_000"), true);
  assert.equal(queue.includes("const armWatchdog = () =>"), true);
  assert.equal(queue.includes("heartbeat !== lastHeartbeat"), true);
  assert.equal(queue.includes("const COMPARISON_STALE_MS = 30 * 60_000"), true);
});
