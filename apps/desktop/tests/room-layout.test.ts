import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { resolveMemberSceneZones } from "../src/renderer/src/features/voice-scene/sceneZones";
import { readRendererCss } from "./helpers/read-renderer-css";

const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const homePagePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const overlayWindowPath = path.resolve(process.cwd(), "src/main/overlay-window.ts");
const overlayPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/OverlayPage.tsx");
const mainWindowPath = path.resolve(process.cwd(), "src/main/window.ts");
const screenCaptureServicePath = path.resolve(process.cwd(), "src/main/screen-capture-service.ts");
const rendererMainPath = path.resolve(process.cwd(), "src/renderer/src/main.tsx");
const chatPanelPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/chat/TemporaryChatPanel.tsx",
);
const chatLinkPreviewPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/chat/linkPreview.ts",
);
const quickRepliesPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/chat/quickReplies.ts",
);
const teamIslandPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/TeamIsland.tsx",
);
const dateCalendarPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/RoomDateCalendar.tsx",
);
const collectionShelfPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/RoomCollectionShelf.tsx",
);
const workMonitorPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/WorkMonitorContent.tsx",
);
const idleMonitorPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/IdleMonitorContent.tsx",
);
const activityRulesPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/voice-scene/activityRules.ts",
);
const sceneCharacterPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/SceneCharacter.tsx",
);
const sceneCharacterLabelPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/SceneCharacterLabel.tsx",
);
const musicActivityBadgePath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/MusicActivityBadge.tsx",
);
const roomStateHookPath = path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts");
const reliableChatTransportPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/chat/ReliableChatTransport.ts",
);
const characterMotionPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/voice-scene/characterMotion.ts",
);
const screenShareManagerPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/screen-share/ScreenShareManager.ts",
);
const screenShareHookPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/screen-share/useScreenShare.ts",
);
const screenShareViewerPreloadPath = path.resolve(
  process.cwd(),
  "src/preload/screen-share-viewer.ts",
);
const workstationArtPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/WorkstationArt.tsx",
);
const sceneAmbientDecorPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/SceneAmbientDecor.tsx",
);
const sceneZonesPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/voice-scene/sceneZones.ts",
);
const sharedOverlaysPath = path.resolve(process.cwd(), "src/renderer/src/pages/SharedOverlays.tsx");
const installerPath = path.resolve(process.cwd(), "electron-builder.yml");
const appPath = path.resolve(process.cwd(), "src/renderer/src/app/App.tsx");
const toastRegionPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/layout/ToastRegion.tsx",
);
const recordingMainPath = path.resolve(process.cwd(), "src/main/recording-main.ts");

test("room page uses the V5 island, light responses, and voice dock", () => {
  const source = readFileSync(roomPagePath, "utf8");
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const dockSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomDock.tsx"),
    "utf8",
  );
  const audioPopoverSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/audio/AudioControlPopover.tsx"),
    "utf8",
  );

  assert.equal(source.includes("TemporaryChatPanel"), true);
  assert.equal(source.includes("TeamIsland"), true);
  assert.equal(source.includes("desktopApi.overlay.toggle"), true);
  assert.equal(source.includes("useScreenShare"), true);
  assert.equal(source.includes("ScreenSharePanel"), true);
  assert.equal(dockSource.includes("voice-dock"), true);
  assert.equal(source.includes("房间地址"), false);
  assert.equal(source.includes("连接方式"), false);
  assert.equal(source.includes("进入开黑频道"), false);
  assert.equal(source.includes("audio-level-bars"), false);
  assert.equal(dockSource.includes("扬声器关"), true);
  assert.equal(audioPopoverSource.includes("降噪"), true);
  assert.equal(audioPopoverSource.includes('data-audio-setting="noise-suppression"'), true);
  assert.equal(audioPopoverSource.includes('data-audio-setting="echo-cancellation"'), true);
  assert.equal(audioPopoverSource.includes('data-audio-setting="voice-enhancement"'), true);
  assert.equal(audioPopoverSource.includes('ariaLabel="切换回声消除"'), true);
  assert.equal(audioPopoverSource.includes('ariaLabel="切换自然人声"'), true);
  assert.equal(source.includes("noise-suppression-button"), false);
  assert.equal(audioPopoverSource.includes('ariaLabel="切换降噪"'), true);
  assert.equal(audioPopoverSource.includes("hasMicrophoneProcessing ? deviceSelect : null"), true);
  assert.equal(
    audioPopoverSource.indexOf("hasMicrophoneProcessing ? deviceSelect : null") <
      audioPopoverSource.indexOf('className="audio-control-popover-slider"'),
    true,
  );
  assert.equal(source.includes("朋友的小收藏箱"), false);
  assert.equal(source.includes("留下一句话或链接，会一直保留"), false);
  assert.equal(source.includes("把下次开黑时间、攻略链接"), false);
  const collectionShelfSource = readFileSync(collectionShelfPath, "utf8");
  assert.equal(dockSource.includes('data-icon-motion="collection"'), false);
  assert.equal(collectionShelfSource.includes("room-collection-shelf"), true);
  assert.equal(collectionShelfSource.includes("items.slice(-6)"), true);
  assert.equal(collectionShelfSource.includes("room-collection-drop-feedback"), true);
  assert.equal(collectionShelfSource.includes("松开放入"), true);
  assert.equal(teamIslandSource.includes("<RoomCollectionShelf"), true);
  assert.equal(teamIslandSource.includes("<SceneLowTable"), false);
});

test("seat switching uses the full visible workstation area", () => {
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const stylesSource = readRendererCss();
  const sceneZonesSource = readFileSync(sceneZonesPath, "utf8");

  assert.equal(teamIslandSource.includes("absolute inset-0 z-[18]"), true);
  assert.match(stylesSource, /\.scene-workstation\s*\{[^}]*pointer-events:\s*none;/s);
  assert.equal(sceneZonesSource.match(/width: 21/g)?.length, 5);
  assert.equal(sceneZonesSource.match(/height: 27/g)?.length, 5);
});

test("exit label stays clear of the door arrow", () => {
  const stylesSource = readRendererCss();

  assert.match(stylesSource, /\.scene-service-restroom \.scene-exit-label\s*\{[^}]*top:\s*9%;/s);
});

test("work and game activities animate on the monitor without replacing voice state", () => {
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const workMonitorSource = readFileSync(workMonitorPath, "utf8");
  const idleMonitorSource = readFileSync(idleMonitorPath, "utf8");
  const activityRulesSource = readFileSync(activityRulesPath, "utf8");
  const stylesSource = readRendererCss();

  assert.equal(teamIslandSource.includes("<WorkMonitorContent"), true);
  assert.equal(teamIslandSource.includes("settledOccupant.gameName"), true);
  assert.equal(teamIslandSource.includes("settledOccupant.workActivity"), true);
  assert.equal(teamIslandSource.includes("shouldReduceMotion={shouldReduceMotion}"), true);
  assert.equal(workMonitorSource.includes('mode === "code"'), true);
  assert.equal(workMonitorSource.includes('mode === "media"'), true);
  assert.equal(workMonitorSource.includes('mode === "engineering"'), true);
  assert.equal(workMonitorSource.includes('mode === "data"'), true);
  assert.equal(workMonitorSource.includes('mode === "office"'), true);
  assert.equal(workMonitorSource.includes("gsap.context"), true);
  assert.equal(workMonitorSource.includes("repeat: -1"), true);
  assert.equal(workMonitorSource.includes("observer?.disconnect()"), true);
  assert.equal(workMonitorSource.includes("context.revert()"), true);
  assert.equal(teamIslandSource.includes("<IdleMonitorContent"), true);
  assert.equal(teamIslandSource.includes("offsetSeconds={slotIndex * 48}"), true);
  assert.equal(idleMonitorSource.includes("idle-monitors/window-sky.png"), true);
  assert.equal(idleMonitorSource.includes("--idle-monitor-offset"), true);
  assert.equal(idleMonitorSource.includes("idle-monitors/aquarium.png"), false);
  assert.equal(activityRulesSource.includes("正在玩"), true);
  assert.equal(activityRulesSource.includes("workActivity.name"), true);
  assert.equal(stylesSource.includes(".scene-workstation-screen.working"), true);
  assert.equal(stylesSource.includes(".scene-work-monitor"), true);
});

test("room uses a real always-on-top overlay and a ten-second knock cooldown", () => {
  const roomSource = readFileSync(roomPagePath, "utf8");
  const overlaySource = readFileSync(overlayWindowPath, "utf8");
  const overlayPageSource = readFileSync(overlayPagePath, "utf8");
  const rendererMainSource = readFileSync(rendererMainPath, "utf8");
  const stylesSource = readRendererCss();
  const chatSource = readFileSync(chatPanelPath, "utf8");
  const chatLinkPreviewSource = readFileSync(chatLinkPreviewPath, "utf8");
  const quickRepliesSource = readFileSync(quickRepliesPath, "utf8");
  const roomStateSource = readFileSync(roomStateHookPath, "utf8");
  const reliableChatTransportSource = readFileSync(reliableChatTransportPath, "utf8");
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const sceneCharacterSource = readFileSync(sceneCharacterPath, "utf8");
  const characterMotionSource = readFileSync(characterMotionPath, "utf8");
  const sceneZonesSource = readFileSync(sceneZonesPath, "utf8");

  assert.equal(roomSource.includes("KNOCK_COOLDOWN_MS = 10_000"), true);
  assert.equal(roomSource.includes("desktopApi.overlay.toggle"), true);
  assert.equal(overlaySource.includes("alwaysOnTop: true"), true);
  assert.equal(overlaySource.includes("skipTaskbar: true"), true);
  assert.equal(overlaySource.includes("overlay-bounds.json"), true);
  assert.equal(overlaySource.includes("OVERLAY_WIDTH = 142"), true);
  assert.equal(overlaySource.includes("OVERLAY_ROW_HEIGHT = 36"), true);
  assert.equal(overlaySource.includes("OVERLAY_MAX_HEIGHT"), true);
  assert.equal(overlayPageSource.includes('flexDirection: "column"'), true);
  assert.equal(overlaySource.includes("show(): boolean"), true);
  assert.equal(overlaySource.includes("focusable: false"), true);
  assert.equal(overlaySource.includes("setIgnoreMouseEvents(true"), true);
  assert.equal(overlaySource.includes("setMovable(false)"), true);
  assert.equal(overlaySource.includes("setContentProtection(true)"), false);
  assert.equal(overlaySource.includes("resizable: false"), true);
  assert.equal(overlayPageSource.includes("data-overlay-list"), true);
  assert.equal(overlayPageSource.includes("gsap.fromTo"), true);
  assert.equal(overlayPageSource.includes("TOOLS_REVEAL_SECONDS = 1"), true);
  assert.equal(overlayPageSource.includes("overlay-still-progress"), true);
  assert.equal(overlayPageSource.includes('pathLength="100"'), true);
  assert.equal(overlayPageSource.includes("strokeDashoffset: 0"), true);
  assert.equal(overlayPageSource.includes("dragPointerOffsetRef.current"), true);
  assert.equal(overlayPageSource.includes("event.screenY - dragPointerOffsetRef.current"), true);
  assert.equal(overlaySource.includes("gridSize = 16"), true);
  assert.equal(overlaySource.includes("snapOverlayTop("), true);
  assert.equal(overlaySource.includes("resizeOverlayKeepingTop("), true);
  assert.equal(overlaySource.includes('window.on("moved"'), false);
  assert.equal(overlaySource.includes("screen.getCursorScreenPoint()"), true);
  assert.equal(overlaySource.includes("this.window.setPosition(this.snapX"), true);
  assert.equal(stylesSource.includes(".overlay-still-progress-value"), true);
  assert.equal(roomSource.includes("pauseVisualMotion={roomCollection.isOpen}"), true);
  assert.equal(roomSource.includes("performance-gaming"), false);
  assert.equal(stylesSource.includes(".team-island.is-visual-motion-paused *\n"), false);
  assert.equal(stylesSource.includes(".team-island.is-visual-motion-paused .weather-cloud"), true);
  assert.equal(teamIslandSource.includes("isCharacterMotionActive"), true);
  assert.equal(teamIslandSource.includes("shouldPauseAmbientMotion"), true);
  assert.equal(
    stylesSource.includes(".team-island.is-character-motion-active .weather-cloud"),
    true,
  );
  assert.match(
    stylesSource,
    /\.team-island\.is-character-motion-active[\s\S]*\.scene-character-motion:is\(\.phase-idle, \.phase-away-idle\)/,
  );
  assert.equal(stylesSource.includes(".collection-modal-panel.modal-surface"), true);
  assert.equal(stylesSource.includes("contain-intrinsic-size: auto 86px"), true);
  assert.equal(rendererMainSource.includes("overlay-renderer"), true);
  assert.equal(stylesSource.includes("html.overlay-renderer"), true);
  assert.equal(stylesSource.includes("background: transparent !important"), true);
  assert.equal(chatSource.includes('message.kind === "system"'), true);
  assert.equal(chatSource.includes("AvatarPlaceholder"), true);
  assert.equal(chatSource.includes("MessageLinkPreview"), true);
  assert.equal(chatSource.includes("formatCompactUrl"), true);
  assert.equal(chatLinkPreviewSource.includes("getMessageUrlDetails"), true);
  assert.equal(chatSource.includes("<Link2 />"), true);
  assert.equal(chatSource.includes("QUICK_REPLIES.map"), true);
  assert.equal(quickRepliesSource.includes('"听得到吗"'), true);
  assert.equal(roomSource.includes("chatBubbles={characterChatBubbles}"), true);
  assert.equal(teamIslandSource.includes("chatBubbleByPeerId.get(member.id)"), true);
  assert.equal(sceneCharacterSource.includes("CharacterChatBubble"), true);
  assert.equal(stylesSource.includes(".scene-character-chat-bubble"), true);
  assert.equal(roomStateSource.includes("sendSystemNotification({"), true);
  assert.equal(roomStateSource.includes("sendQuickMessage"), true);
  assert.equal(roomStateSource.includes("playAnimalCall"), true);
  assert.equal(quickRepliesSource.includes("QUICK_REPLY_COOLDOWN_MS = 3_000"), true);
  assert.equal(chatSource.includes("isQuickSendCoolingDown"), true);
  assert.equal(
    reliableChatTransportSource.includes("this.pendingSends.has(clientMessageId)"),
    true,
  );
  assert.equal(reliableChatTransportSource.includes("this.handleAck({"), true);
  assert.equal(reliableChatTransportSource.includes("findLegacyPending(payload)"), true);
  assert.equal(reliableChatTransportSource.includes("scheduleLegacyConfirmation"), true);
  assert.equal(teamIslandSource.includes("scene-zone-hotspot"), true);
  assert.equal(teamIslandSource.includes("scene-seat-marker"), true);
  assert.equal(teamIslandSource.includes("team-island-stage"), true);
  assert.equal(teamIslandSource.includes("scene-workstation"), true);
  assert.equal(sceneZonesSource.includes("restroomZone"), true);
  assert.equal(sceneZonesSource.includes('label: "离开"'), true);
  assert.equal(sceneZonesSource.includes("seatSlots"), true);
  assert.equal(sceneZonesSource.includes("activityZones"), true);
  assert.equal(sceneZonesSource.includes('kind: "seat"'), true);
  assert.equal(sceneZonesSource.includes('kind: "activity"'), true);
  assert.equal(teamIslandSource.includes("duration: travelDuration * 0.46"), false);
  assert.equal(teamIslandSource.includes("duration: travelDuration * 0.54"), false);
  assert.equal(teamIslandSource.includes("middleLeft"), false);
  assert.equal(sceneCharacterSource.includes("planCharacterRoute"), true);
  assert.equal(characterMotionSource.includes("export const planCharacterRoute"), true);
});

test("each remote member has compact local-only volume and mute controls", () => {
  const sceneCharacterSource = readFileSync(sceneCharacterPath, "utf8");
  const sceneCharacterLabelSource = readFileSync(sceneCharacterLabelPath, "utf8");
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const roomStateSource = readFileSync(roomStateHookPath, "utf8");
  const volumePersistenceSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/room/memberVolumePersistence.ts"),
    "utf8",
  );
  const stylesSource = readRendererCss();

  assert.equal(sceneCharacterSource.includes("member-audio-popover"), true);
  assert.equal(sceneCharacterLabelSource.includes("room-character-volume-hint"), false);
  assert.equal(sceneCharacterLabelSource.includes("room-character-volume-entry"), false);
  assert.equal(sceneCharacterSource.includes("点击调整${member.nickname}在本机的音量"), true);
  assert.equal(sceneCharacterSource.includes("member-audio-mute-toggle"), true);
  assert.equal(sceneCharacterSource.includes("max={300}"), true);
  assert.equal(sceneCharacterSource.includes("只调整你听到的声音"), false);
  assert.equal(sceneCharacterSource.includes("恢复默认"), false);
  assert.equal(sceneCharacterSource.includes("member-audio-scale"), false);
  assert.equal(sceneCharacterSource.includes("zIndex: isAudioControlsOpen ? 80"), true);
  assert.equal(sceneCharacterSource.includes("member-audio-popover is-label-control"), true);
  assert.equal(sceneCharacterSource.includes("shouldPlaceAudioPopoverAbove"), false);
  assert.equal(sceneCharacterSource.includes("toggleLocalMemberMute"), true);
  assert.equal(roomStateSource.includes("runtimeMemberVolumes"), true);
  assert.equal(volumePersistenceSource.includes("pendingSaves"), true);
  assert.equal(roomStateSource.includes("activeClient?.setPeerVolume"), true);
  assert.equal(stylesSource.includes("width: 194px"), true);
  assert.equal(stylesSource.includes("top: calc(100% + 6px)"), true);
  assert.equal(stylesSource.includes(".scene-character-anchor.is-audio-controls-open"), true);
  assert.equal(stylesSource.includes("scale: calc(1 / var(--character-scale))"), true);
  assert.match(stylesSource, /\.scene-zone-hotspot:disabled\s*\{[^}]*pointer-events:\s*none;/s);
  assert.equal(
    teamIslandSource.includes('className="pointer-events-none absolute inset-0 z-[18]"'),
    true,
  );
  assert.equal(teamIslandSource.includes("scene-zone-hotspot pointer-events-auto"), true);
  assert.equal(
    stylesSource.includes(
      ".room-character-interaction-target.is-interactive .room-character-label",
    ),
    true,
  );
});

test("music activity stays attached to a member while seats change", () => {
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const badgeSource = readFileSync(musicActivityBadgePath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");
  const stylesSource = readRendererCss();

  assert.equal(teamIslandSource.includes("const occupant = memberBySeat.get(slot.id)"), true);
  assert.equal(teamIslandSource.includes("const settledMemberBySeat = new Map"), true);
  assert.equal(teamIslandSource.includes("settledMemberBySeat.get(slot.id)"), true);
  assert.equal(teamIslandSource.includes("onSettled={handleMemberSettled}"), true);
  assert.equal(teamIslandSource.includes("occupant.musicActivity"), true);
  assert.equal(badgeSource.includes("is-tooltip-open"), true);
  assert.equal(badgeSource.includes("scheduleTooltipClose"), true);
  assert.equal(badgeSource.includes('activity.provider === "applemusic"'), true);
  assert.equal(badgeSource.includes("<Headphones"), false);
  assert.equal(badgeSource.includes("providerPath[activity.provider]"), true);
  assert.equal(badgeSource.includes("apple-music.png"), true);
  assert.equal(stylesSource.includes("pointer-events: none"), true);
  assert.equal(roomSource.includes("detectedMusicRef.current ?? localMember?.musicActivity"), true);
  assert.equal(roomSource.includes("hasDetectionSnapshotRef.current = true"), true);
  assert.equal(roomSource.includes("detectedMusicActivityKey === localMusicActivityKey"), true);
});

test("desktop build includes custom nsis shortcut icon wiring", () => {
  const source = readFileSync(installerPath, "utf8");
  const installer = readFileSync(path.resolve(process.cwd(), "build/installer.nsh"), "utf8");

  assert.equal(source.includes("include: build/installer.nsh"), true);
  assert.equal(source.includes("shanghao-shortcut-v3.ico"), true);
  assert.equal(installer.includes("--shanghao-quit-for-install"), true);
  assert.equal(installer.includes("customCheckAppRunning"), true);
  assert.equal(installer.includes("shutdownShangHaoProcesses"), true);
  assert.equal(installer.includes("requestShangHaoQuitByName"), true);
  assert.equal(installer.includes("绝不能在应用没有运行时启动 EXE"), true);
  assert.equal(installer.includes("正在修复旧版覆盖安装组件"), true);
  assert.equal(installer.includes("killShangHaoProcessByInstallDir"), true);
  assert.equal(installer.includes('"上号.exe"'), true);
});

test("update gate owns update UI without the floating duplicate card", () => {
  const source = readFileSync(sharedOverlaysPath, "utf8");

  assert.equal(source.includes('bootstrapPhase === "ready" ? <UpdateModal /> : null'), true);
});

test("scene seats align with the marked workstation positions", () => {
  const sceneZonesSource = readFileSync(sceneZonesPath, "utf8");
  const stylesSource = readRendererCss();
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const dateCalendarSource = readFileSync(dateCalendarPath, "utf8");
  const workstationSource = readFileSync(workstationArtPath, "utf8");
  const ambientDecorSource = readFileSync(sceneAmbientDecorPath, "utf8");
  const sceneCharacterSource = readFileSync(sceneCharacterPath, "utf8");

  assert.equal(stylesSource.includes(".scene-workstation"), true);
  assert.equal(stylesSource.includes(".scene-workstation-art-frame"), true);
  assert.equal(stylesSource.includes(".scene-workstation-art"), true);
  assert.equal(stylesSource.includes("left: 29.35%"), true);
  assert.equal(stylesSource.includes("top: 8.7%"), true);
  assert.equal(stylesSource.includes("width: 41.3%"), true);
  assert.equal(teamIslandSource.includes("WorkstationArt"), true);
  assert.equal(teamIslandSource.includes("workstation-chibi.webp"), false);
  assert.equal(workstationSource.includes('viewBox="0 0 184 138"'), true);
  assert.equal(stylesSource.includes("transform: translate(-50%, -50%);"), true);
  assert.equal(stylesSource.includes("translateY(-3px) scale(1.018)"), false);
  assert.equal(teamIslandSource.includes("scene-restroom-door"), false);
  assert.equal(teamIslandSource.includes("scene-shared-table"), false);
  assert.equal(teamIslandSource.includes("DynamicWeatherWindow"), true);
  assert.equal(teamIslandSource.includes("SceneFloorLamp"), false);
  assert.equal(dateCalendarSource.includes("SceneWallShelf"), false);
  assert.equal(teamIslandSource.includes("RoomDateCalendar"), true);
  assert.equal(dateCalendarSource.includes("desktopApi.recording"), false);
  assert.equal(dateCalendarSource.includes("DAY_FORMATTER"), true);
  assert.equal(dateCalendarSource.includes('new Intl.DateTimeFormat("en-US"'), true);
  assert.equal(dateCalendarSource.includes("room-date-calendar"), true);
  assert.equal(dateCalendarSource.includes("room-date-calendar-month"), true);
  assert.equal(dateCalendarSource.includes("WEEKDAY_FORMATTER.format(today)"), true);
  assert.equal(dateCalendarSource.includes("FULL_DATE_FORMATTER"), true);
  assert.equal(dateCalendarSource.includes("room-date-calendar-tooltip"), true);
  assert.equal(teamIslandSource.includes("SceneWallClock"), true);
  assert.equal(teamIslandSource.includes("SceneExitDoor"), true);
  assert.equal(teamIslandSource.includes('localZone === "restroomZone"'), true);
  assert.equal(teamIslandSource.includes("SceneTallPlant"), false);
  assert.equal(teamIslandSource.includes("SceneLowTable"), false);
  assert.equal(teamIslandSource.includes("scene-wall-backdrop"), true);
  assert.equal(teamIslandSource.includes("scene-wall-baseboard"), false);
  assert.equal(teamIslandSource.includes("scene-lounge-corner"), false);
  assert.equal(stylesSource.includes(".scene-window-nook"), true);
  assert.equal(stylesSource.includes(".dynamic-weather-window"), true);
  assert.equal(stylesSource.includes("width: clamp(218px, 22.5%, 302px)"), true);
  assert.equal(stylesSource.includes(".scene-weather-ambient"), true);
  assert.equal(stylesSource.includes(".scene-wall-shelf"), true);
  assert.equal(stylesSource.includes(".scene-wall-clock"), true);
  assert.equal(stylesSource.includes(".weather-window-tooltip"), true);
  assert.equal(stylesSource.includes(".scene-clock-tooltip"), true);
  assert.equal(
    stylesSource.includes(".room-date-calendar:hover .room-date-calendar-tooltip"),
    true,
  );
  assert.match(
    stylesSource,
    /\.room-date-calendar-today strong\s*\{[^}]*font-family:\s*\n\s*"Noto Sans SC Variable"[^}]*font-variant-numeric:\s*tabular-nums;/s,
  );
  assert.match(
    stylesSource,
    /\.room-date-calendar-paper\s*\{[^}]*0 8px 16px rgba\(72, 110, 143, 0\.075\)/s,
  );
  assert.equal(stylesSource.includes(".room-date-calendar-paper::before"), false);
  assert.match(
    stylesSource,
    /\.room-date-calendar\s*\{[^}]*left:\s*52\.4%;[^}]*transform:\s*translateX\(-50%\);/s,
  );
  assert.equal(stylesSource.includes(".room-collection-shelf-position"), true);
  assert.equal(teamIslandSource.includes("RoomCollectionShelf"), true);
  assert.equal(stylesSource.includes(".room-collection-shelf-display"), true);
  assert.equal(ambientDecorSource.includes('viewBox="0 0 180 110"'), true);
  assert.equal(ambientDecorSource.includes('viewBox="0 0 94 218"'), true);
  assert.equal(teamIslandSource.includes("chatMessages?: ChatMessage[]"), false);
  assert.equal(sceneCharacterSource.includes("WalkingAnimalSprite"), true);
  assert.equal(stylesSource.includes(".desk-animal-layer"), true);
  assert.equal(stylesSource.includes(".desk-animal-chair-front"), false);
  assert.equal(sceneZonesSource.includes("gameDesk5: { left: 65, top: 70.7"), true);
  assert.equal(sceneZonesSource.includes("gameDesk4: { left: 40, top: 70.7"), true);
  assert.equal(sceneZonesSource.includes("gameDesk1: { left: 30, top: 34.7"), true);
  assert.equal(sceneZonesSource.includes("restroomZone: { left: 13, top: 74"), true);
  assert.equal(
    sceneZonesSource.includes("gameDesk1: { left: 30, top: 34.7, zIndex: 24, scale: 1"),
    true,
  );
});

test("client-side scene arbitration keeps duplicate member seats visually unique", () => {
  const zones = resolveMemberSceneZones([
    {
      id: "second",
      joinedAt: "2026-07-01T10:00:01.000Z",
      sceneZone: "gameDesk1",
    },
    {
      id: "first",
      joinedAt: "2026-07-01T10:00:00.000Z",
      sceneZone: "gameDesk1",
    },
    {
      id: "away",
      joinedAt: "2026-07-01T10:00:02.000Z",
      sceneZone: "restroomZone",
    },
  ]);

  assert.equal(zones.get("first"), "gameDesk1");
  assert.equal(zones.get("second"), "gameDesk2");
  assert.equal(zones.get("away"), "restroomZone");
});

test("screen sharing is wired through the room page and WebRTC peer layer", () => {
  const roomSource = readFileSync(roomPagePath, "utf8");
  const hookSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts"),
    "utf8",
  );
  const clientSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/room/roomClient.ts"),
    "utf8",
  );
  const peerSource = readFileSync(
    path.resolve(process.cwd(), "../../packages/webrtc/src/createPeer.ts"),
    "utf8",
  );
  const stylesSource = readRendererCss();
  const mainWindowSource = readFileSync(mainWindowPath, "utf8");
  const screenCaptureServiceSource = readFileSync(screenCaptureServicePath, "utf8");
  const managerSource = readFileSync(screenShareManagerPath, "utf8");
  const screenShareHookSource = readFileSync(screenShareHookPath, "utf8");
  const viewerPreloadSource = readFileSync(screenShareViewerPreloadPath, "utf8");
  const screenPanelSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/ScreenSharePanel.tsx"),
    "utf8",
  );
  const screenPanelContainerSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/ScreenSharePanelContainer.tsx"),
    "utf8",
  );
  const screenRelaySource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/screen-share/ScreenFrameRelay.ts"),
    "utf8",
  );
  const screenCoordinatorSource = readFileSync(
    path.resolve(
      process.cwd(),
      "src/renderer/src/features/screen-share/RoomScreenShareCoordinator.ts",
    ),
    "utf8",
  );
  const detachedPublisherSource = readFileSync(
    path.resolve(
      process.cwd(),
      "src/renderer/src/features/screen-share/DetachedScreenSharePublisher.ts",
    ),
    "utf8",
  );

  assert.equal(managerSource.includes("navigator.mediaDevices.getDisplayMedia"), true);
  assert.equal(screenPanelSource.includes("screen-share-panel"), true);
  assert.equal(roomSource.includes("ScreenSharePanelContainer"), true);
  assert.equal(screenPanelContainerSource.includes("remoteScreenFrames"), true);
  assert.equal(roomSource.includes("useScreenShare"), true);
  assert.equal(screenShareHookSource.includes("new ScreenShareManager"), true);
  assert.equal(hookSource.includes("startScreenShare"), true);
  assert.equal(hookSource.includes("setRemoteScreenFrame"), true);
  assert.equal(clientSource.includes("renegotiateAllPeers"), false);
  assert.equal(screenRelaySource.includes("screen_frame"), true);
  assert.equal(screenRelaySource.includes("const MAX_WIDTH = 1_280"), true);
  assert.equal(screenRelaySource.includes("const MAX_BYTES = 180 * 1024"), true);
  assert.equal(detachedPublisherSource.includes("maxBitrate = 12_000_000"), true);
  assert.equal(
    detachedPublisherSource.includes('degradationPreference = "maintain-resolution"'),
    true,
  );
  assert.equal(screenCoordinatorSource.includes("SCREEN_FRAME_INTERVAL_MS"), true);
  assert.equal(peerSource.includes('addTransceiver("video"'), true);
  assert.equal(peerSource.includes('direction: "sendrecv"'), true);
  assert.equal(
    peerSource.includes(
      "encoding.maxBitrate = Math.round(profile.maxBitrate * networkProfile.screenBitrateScale)",
    ),
    true,
  );
  assert.equal(peerSource.includes("DEFAULT_SCREEN_SHARE_PROFILE"), true);
  assert.equal(
    peerSource.includes('parameters.degradationPreference = "maintain-framerate"'),
    true,
  );
  assert.equal(peerSource.includes("screenScaleResolutionDownBy: 1"), true);
  assert.equal(peerSource.includes("offerToReceiveVideo: true"), true);
  assert.equal(peerSource.includes("setScreenTrack"), true);
  assert.equal(stylesSource.includes(".screen-share-video"), true);
  assert.equal(stylesSource.includes(".screen-share-panel-expanded"), false);
  assert.equal(managerSource.includes("screenShareViewer"), true);
  assert.equal(screenPanelSource.includes("local-share-safe-preview"), true);
  assert.equal(roomSource.includes("本地预览已隐藏，避免画面无限套娃"), false);
  assert.equal(screenPanelSource.includes("requestVideoFrameCallback"), true);
  assert.equal(managerSource.includes("setContentProtection(true)"), true);
  assert.equal(managerSource.includes("setContentProtection(false)"), true);
  assert.equal(screenPanelSource.includes("isDetaching || primaryItem.isLocal"), false);
  assert.equal(screenPanelSource.includes("disabled={isDetaching}"), true);
  assert.equal(mainWindowSource.includes("openScreenShareViewer"), true);
  assert.equal(mainWindowSource.includes("viewer.maximize()"), false);
  assert.equal(mainWindowSource.includes("workArea.width * 0.85"), true);
  assert.equal(mainWindowSource.includes("workArea.height * 0.85"), true);
  assert.equal(mainWindowSource.includes("setContentProtection(true)"), true);
  assert.equal(mainWindowSource.includes("setScreenCaptureContentProtection"), true);
  assert.equal(screenCaptureServiceSource.includes("appWindowSourceIds"), true);
  assert.equal(mainWindowSource.includes("sendScreenShareViewerSignal"), true);
  assert.equal(managerSource.includes("DetachedScreenSharePublisher"), true);
  assert.equal(managerSource.includes("toDataURL"), false);
  assert.equal(managerSource.includes("SCREEN_SHARE_PROFILES"), true);
  assert.equal(roomSource.includes("const [screenFrameNow"), false);
  assert.equal(roomSource.includes("useAudioStore()"), false);
  assert.equal(roomSource.includes("}, 2_000);"), true);
  assert.equal(screenPanelContainerSource.includes("detachedSyncTimerRef"), true);
  assert.equal(screenPanelContainerSource.includes("}, 200)"), true);
  assert.equal(viewerPreloadSource.includes("screenShareViewerApi"), true);
  assert.equal(viewerPreloadSource.includes("desktopApi"), false);
  assert.equal(roomSource.includes("screen-share-fit-action"), false);
  assert.equal(screenPanelSource.includes("screen-share-drag-handle"), true);
  assert.equal(mainWindowSource.includes("setDisplayMediaRequestHandler"), true);
  assert.equal(screenCaptureServiceSource.includes("desktopCapturer.getSources"), true);
  assert.equal(screenCaptureServiceSource.includes("this.waitForSources(true, true)"), true);
  assert.equal(
    screenCaptureServiceSource.includes(
      "thumbnailSize: withThumbnails ? { width: 320, height: 180 }",
    ),
    true,
  );
  assert.equal(mainWindowSource.includes('"loopback"'), true);
  assert.equal(roomSource.includes("startSharingScreen(sourceId, quality, origin)"), true);
  const overlaysSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomOverlays.tsx"),
    "utf8",
  );
  assert.equal(overlaysSource.includes('{ value: "1440p", detail: "2K" }'), true);
  assert.equal(overlaysSource.includes("SCREEN_SHARE_QUALITY_OPTIONS.map"), true);
  assert.equal(overlaysSource.includes("DEFAULT_SCREEN_SHARE_QUALITY"), true);
  assert.equal(overlaysSource.includes("aria-pressed={includeSystemAudio}"), true);
});

test("the first main window opens roomy while saved window bounds still take priority", () => {
  const source = readFileSync(mainWindowPath, "utf8");

  assert.match(source, /display\.workArea\.width \* 0\.88/);
  assert.match(source, /display\.workArea\.height \* 0\.9/);
  assert.match(source, /Math\.min\(\s*1_680,/);
  assert.match(source, /Math\.min\(\s*1_050,/);
  assert.match(source, /savedBounds\.width \?\? defaultWidth/);
  assert.match(source, /savedBounds\.height \?\? defaultHeight/);
});

test("room scene supports clickable seats and silent-away without daily summaries", () => {
  const roomSource = readFileSync(roomPagePath, "utf8");
  const homeSource = readFileSync(homePagePath, "utf8");
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const sceneCharacterSource = readFileSync(sceneCharacterPath, "utf8");

  assert.equal(teamIslandSource.includes("onZoneSelect?.(zone.id, zone.activity)"), true);
  assert.equal(teamIslandSource.includes("disabled={"), true);
  assert.equal(sceneCharacterSource.includes("DeskAnimalSprite"), true);
  assert.equal(roomSource.includes("decideAutoAway"), true);
  assert.equal(roomSource.includes("lastSpokeAtRef"), false);
  assert.match(roomSource, /moveLocalMemberRef\.current\(\s*"restroomZone",\s*"restroom"/);
  assert.equal(roomSource.includes("recordDailySession"), false);
  assert.equal(homeSource.includes("今日开黑小结"), false);
  assert.equal(homeSource.includes("dailySummary"), false);
});

test("entering a channel uses one lightweight route transition without replaying home gsap", () => {
  const homeSource = readFileSync(homePagePath, "utf8");
  const appSource = readFileSync(appPath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");

  assert.equal(homeSource.includes("const isSettingsReady = Boolean(settings)"), true);
  assert.equal(homeSource.includes("[isQuickEntry, isSettingsReady, reduceMotion]"), false);
  assert.equal(homeSource.includes("[isSettingsReady, reduceMotion]"), true);
  assert.equal(homeSource.includes('<AnimatePresence initial={false} mode="wait">'), false);
  assert.equal(homeSource.includes('layout="size"'), false);
  assert.equal(homeSource.includes("hasPlayedHomeEntrance"), true);
  assert.equal(homeSource.includes("entry-server-status-slot"), true);
  assert.equal(homeSource.includes("[reduceMotion, settings]"), false);
  assert.equal(homeSource.includes("const [isSubmitting, setIsSubmitting]"), true);
  assert.equal(homeSource.includes("hasSavedEntry"), false);
  assert.equal(homeSource.includes("今晚也一起？"), false);
  assert.equal(homeSource.includes("固定频道已准备好"), false);
  assert.equal(homeSource.includes("欢迎回来"), false);
  assert.equal(homeSource.includes("更换昵称或服务器"), false);
  assert.equal(homeSource.includes("testServer"), true);
  assert.equal(homeSource.includes("normalizeRelayServerUrl"), true);
  assert.equal(homeSource.includes("SERVER_CHECK_HEALTHY_INTERVAL_MS = 45_000"), true);
  assert.equal(homeSource.includes("window.setInterval"), false);
  assert.equal(homeSource.includes('document.addEventListener("visibilitychange"'), true);
  assert.equal(appSource.includes("const roomPagePromise = loadRoomPage()"), true);
  assert.equal(roomSource.includes("{ autoAlpha: 0.94, y: 5 }"), false);
  assert.equal(appSource.includes('basePage === "room" ? { opacity: 0 } : false'), false);
  assert.equal(appSource.includes("<motion.div"), true);
  assert.equal(appSource.includes("key={basePage}"), true);
  assert.equal(appSource.includes("{ opacity: 0, y: 4 }"), true);
  assert.equal(roomSource.includes("[data-gsap-room='island']"), false);
});

test("room navigation stays mounted behind settings and lightweight motion avoids blur", () => {
  const appSource = readFileSync(appPath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");
  const stylesSource = readRendererCss();

  assert.equal(appSource.includes("app-page-base"), true);
  assert.equal(appSource.includes('basePage === "room" ? <RoomPage /> : <HomePage />'), true);
  assert.equal(roomSource.includes('filter: "blur(6px)"'), false);
  assert.equal(stylesSource.includes(".app-page-base.is-obscured"), true);
  assert.match(stylesSource, /\.team-island-stage\s*\{[^}]*filter:\s*none;/s);
  assert.match(
    stylesSource,
    /\.app-page-base\.is-obscured \*[^}]*animation-play-state:\s*paused !important;/s,
  );
  assert.equal(stylesSource.includes(".voice-exit-button"), true);
});

test("toasts stay above controls and first-run nickname starts empty", () => {
  const toastSource = readFileSync(toastRegionPath, "utf8");
  const homeSource = readFileSync(homePagePath, "utf8");

  assert.equal(toastSource.includes("top-[74px]"), true);
  assert.equal(toastSource.includes("bottom-5 right-5"), false);
  assert.equal(homeSource.includes('useState("")'), true);
  assert.equal(homeSource.includes("randomNickname()"), false);
});

test("Windows package keeps only needed locales and recording no longer ships ffprobe", () => {
  const installerSource = readFileSync(installerPath, "utf8");
  const packageSource = readFileSync(path.resolve(process.cwd(), "package.json"), "utf8");
  const recordingSource = readFileSync(recordingMainPath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");

  assert.equal(installerSource.includes("electronLanguages:"), true);
  assert.equal(installerSource.includes("- zh-CN"), true);
  assert.equal(packageSource.includes('"ffprobe-static"'), false);
  assert.equal(recordingSource.includes('from "ffprobe-static"'), false);
  assert.equal(recordingSource.includes("showSaveDialog"), false);
  assert.equal(recordingSource.includes("resolveUsableRecordingDirectory"), true);
  assert.equal(roomSource.includes("chooseDirectory"), true);
  assert.equal(roomSource.includes("recordingSaveDirectory"), true);
});
