import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { resolveMemberSceneZones } from "../src/renderer/src/features/voice-scene/sceneZones";

const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const homePagePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const overlayWindowPath = path.resolve(process.cwd(), "src/main/overlay-window.ts");
const overlayPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/OverlayPage.tsx");
const mainWindowPath = path.resolve(process.cwd(), "src/main/window.ts");
const rendererMainPath = path.resolve(process.cwd(), "src/renderer/src/main.tsx");
const stylesPath = path.resolve(process.cwd(), "src/renderer/src/styles/index.css");
const chatPanelPath = path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx");
const teamIslandPath = path.resolve(process.cwd(), "src/renderer/src/components/room/TeamIsland.tsx");
const sceneZonesPath = path.resolve(process.cwd(), "src/renderer/src/features/voice-scene/sceneZones.ts");
const sharedOverlaysPath = path.resolve(process.cwd(), "src/renderer/src/pages/SharedOverlays.tsx");
const installerPath = path.resolve(process.cwd(), "electron-builder.yml");
const appPath = path.resolve(process.cwd(), "src/renderer/src/app/App.tsx");
const toastRegionPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/layout/ToastRegion.tsx",
);
const profileSetupPath = path.resolve(process.cwd(), "src/renderer/src/pages/ProfileSetupPage.tsx");
const recordingMainPath = path.resolve(process.cwd(), "src/main/recording-main.ts");

test("room page uses the V5 island, light responses, and voice dock", () => {
  const source = readFileSync(roomPagePath, "utf8");

  assert.equal(source.includes("TemporaryChatPanel"), true);
  assert.equal(source.includes("TeamIsland"), true);
  assert.equal(source.includes("desktopApi.overlay.toggle"), true);
  assert.equal(source.includes("getDisplayMedia"), true);
  assert.equal(source.includes("ScreenSharePanel"), true);
  assert.equal(source.includes("voice-dock"), true);
  assert.equal(source.includes("房间地址"), false);
  assert.equal(source.includes("连接方式"), false);
  assert.equal(source.includes("进入开黑频道"), false);
  assert.equal(source.includes("audio-level-bars"), false);
  assert.equal(source.includes("扬声器关"), true);
});

test("room uses a real always-on-top overlay and a five-second knock cooldown", () => {
  const roomSource = readFileSync(roomPagePath, "utf8");
  const overlaySource = readFileSync(overlayWindowPath, "utf8");
  const overlayPageSource = readFileSync(overlayPagePath, "utf8");
  const rendererMainSource = readFileSync(rendererMainPath, "utf8");
  const stylesSource = readFileSync(stylesPath, "utf8");
  const chatSource = readFileSync(chatPanelPath, "utf8");
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const sceneZonesSource = readFileSync(sceneZonesPath, "utf8");

  assert.equal(roomSource.includes("KNOCK_COOLDOWN_MS = 5_000"), true);
  assert.equal(roomSource.includes("desktopApi.overlay.toggle"), true);
  assert.equal(overlaySource.includes("alwaysOnTop: true"), true);
  assert.equal(overlaySource.includes("skipTaskbar: true"), true);
  assert.equal(overlaySource.includes("overlay-bounds.json"), true);
  assert.equal(overlaySource.includes("OVERLAY_MIN_PILL_WIDTH = 88"), true);
  assert.equal(overlaySource.includes("OVERLAY_SHADOW_MARGIN = 0"), true);
  assert.equal(overlaySource.includes("show(): boolean"), true);
  assert.equal(overlaySource.includes("focusable: false"), true);
  assert.equal(overlaySource.includes("setIgnoreMouseEvents(true"), true);
  assert.equal(overlaySource.includes("setMovable(false)"), true);
  assert.equal(overlaySource.includes("resizable: false"), true);
  assert.equal(overlayPageSource.includes("data-overlay-pill"), true);
  assert.equal(overlayPageSource.includes("gsap.fromTo"), true);
  assert.equal(rendererMainSource.includes("overlay-renderer"), true);
  assert.equal(stylesSource.includes("html.overlay-renderer"), true);
  assert.equal(stylesSource.includes("background: transparent !important"), true);
  assert.equal(chatSource.includes('message.kind === "system"'), true);
  assert.equal(chatSource.includes("AvatarPlaceholder"), true);
  assert.equal(teamIslandSource.includes("scene-zone-hotspot"), true);
  assert.equal(teamIslandSource.includes("scene-seat-marker"), true);
  assert.equal(teamIslandSource.includes("team-island-stage"), true);
  assert.equal(teamIslandSource.includes("scene-workstation"), true);
  assert.equal(sceneZonesSource.includes("restroomZone"), true);
  assert.equal(sceneZonesSource.includes('label: "离开一下"'), true);
  assert.equal(sceneZonesSource.includes("seatSlots"), true);
  assert.equal(sceneZonesSource.includes("activityZones"), true);
  assert.equal(sceneZonesSource.includes('kind: "seat"'), true);
  assert.equal(sceneZonesSource.includes('kind: "activity"'), true);
  assert.equal(teamIslandSource.includes("scale: ["), false);
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
  const stylesSource = readFileSync(stylesPath, "utf8");
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");

  assert.equal(stylesSource.includes(".scene-workstation"), true);
  assert.equal(stylesSource.includes(".scene-workstation-art-frame"), true);
  assert.equal(stylesSource.includes(".scene-workstation-art"), true);
  assert.equal(stylesSource.includes("left: 32.5%"), true);
  assert.equal(stylesSource.includes("top: 17.6%"), true);
  assert.equal(stylesSource.includes("width: 35%"), true);
  assert.equal(teamIslandSource.includes("workstation-chibi.webp"), true);
  assert.equal(teamIslandSource.includes("scene-restroom-door"), false);
  assert.equal(stylesSource.includes(".desk-animal-layer"), true);
  assert.equal(stylesSource.includes(".desk-animal-chair-front"), false);
  assert.equal(sceneZonesSource.includes("gameDesk5: { left: 65, top: 74"), true);
  assert.equal(sceneZonesSource.includes("gameDesk4: { left: 40, top: 74"), true);
  assert.equal(sceneZonesSource.includes("gameDesk1: { left: 30, top: 38"), true);
  assert.equal(sceneZonesSource.includes("scale: 0.86"), true);
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
  const hookSource = readFileSync(path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts"), "utf8");
  const clientSource = readFileSync(path.resolve(process.cwd(), "src/renderer/src/features/room/roomClient.ts"), "utf8");
  const peerSource = readFileSync(path.resolve(process.cwd(), "../../packages/webrtc/src/createPeer.ts"), "utf8");
  const stylesSource = readFileSync(stylesPath, "utf8");
  const mainWindowSource = readFileSync(mainWindowPath, "utf8");

  assert.equal(roomSource.includes("navigator.mediaDevices.getDisplayMedia"), true);
  assert.equal(roomSource.includes("screen-share-panel"), true);
  assert.equal(roomSource.includes("remoteScreenFrames"), true);
  assert.equal(hookSource.includes("startScreenShare"), true);
  assert.equal(hookSource.includes("setRemoteScreenFrame"), true);
  assert.equal(clientSource.includes("renegotiateAllPeers"), false);
  assert.equal(clientSource.includes("screen_frame"), true);
  assert.equal(clientSource.includes("SCREEN_FRAME_INTERVAL_MS"), true);
  assert.equal(peerSource.includes('addTransceiver("video"'), true);
  assert.equal(peerSource.includes('direction: "sendrecv"'), true);
  assert.equal(peerSource.includes("encoding.maxBitrate = profile.maxBitrate"), true);
  assert.equal(peerSource.includes("DEFAULT_SCREEN_SHARE_PROFILE"), true);
  assert.equal(peerSource.includes("offerToReceiveVideo: true"), true);
  assert.equal(peerSource.includes("setScreenTrack"), true);
  assert.equal(stylesSource.includes(".screen-share-video"), true);
  assert.equal(stylesSource.includes(".screen-share-panel-expanded"), true);
  assert.equal(roomSource.includes("screen-share-drag-handle"), true);
  assert.equal(mainWindowSource.includes("setDisplayMediaRequestHandler"), true);
  assert.equal(mainWindowSource.includes("desktopCapturer.getSources"), true);
  assert.equal(mainWindowSource.includes('"loopback"'), true);
  assert.equal(roomSource.includes("screenShareQuality"), true);
  assert.equal(roomSource.includes("aria-selected"), true);
});

test("room scene supports clickable seats and silent-away without daily summaries", () => {
  const roomSource = readFileSync(roomPagePath, "utf8");
  const homeSource = readFileSync(homePagePath, "utf8");
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");

  assert.equal(teamIslandSource.includes("onZoneSelect?.(zone.id, zone.activity)"), true);
  assert.equal(teamIslandSource.includes("disabled={"), true);
  assert.equal(teamIslandSource.includes("DeskAnimalSprite"), true);
  assert.equal(roomSource.includes("5 * 60_000"), true);
  assert.equal(roomSource.includes('moveLocalMemberRef.current("restroomZone", "restroom")'), true);
  assert.equal(roomSource.includes("recordDailySession"), false);
  assert.equal(homeSource.includes("今日开黑小结"), false);
  assert.equal(homeSource.includes("dailySummary"), false);
});

test("entering a channel does not replay the whole home entrance animation", () => {
  const homeSource = readFileSync(homePagePath, "utf8");
  const appSource = readFileSync(appPath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");

  assert.equal(homeSource.includes("const isSettingsReady = Boolean(settings)"), true);
  assert.equal(homeSource.includes("[isQuickEntry, isSettingsReady, reduceMotion]"), true);
  assert.equal(homeSource.includes("[reduceMotion, settings]"), false);
  assert.equal(homeSource.includes("const [isSubmitting, setIsSubmitting]"), true);
  assert.equal(homeSource.includes("hasSavedEntry"), true);
  assert.equal(homeSource.includes("今晚也一起？"), true);
  assert.equal(appSource.includes("const roomPagePromise = loadRoomPage()"), true);
  assert.equal(roomSource.includes("{ autoAlpha: 0.94, y: 5 }"), true);
  assert.equal(roomSource.includes("[data-gsap-room='island']"), false);
});

test("room navigation stays mounted behind settings and lightweight motion avoids blur", () => {
  const appSource = readFileSync(appPath, "utf8");
  const roomSource = readFileSync(roomPagePath, "utf8");
  const stylesSource = readFileSync(stylesPath, "utf8");

  assert.equal(appSource.includes("app-page-base"), true);
  assert.equal(appSource.includes('basePage === "room" ? <RoomPage /> : <HomePage />'), true);
  assert.equal(roomSource.includes('filter: "blur(6px)"'), false);
  assert.equal(stylesSource.includes(".app-page-base.is-obscured"), true);
  assert.equal(stylesSource.includes(".voice-exit-button"), true);
});

test("toasts stay above controls and first-run nickname starts empty", () => {
  const toastSource = readFileSync(toastRegionPath, "utf8");
  const profileSource = readFileSync(profileSetupPath, "utf8");

  assert.equal(toastSource.includes("top-[74px]"), true);
  assert.equal(toastSource.includes("bottom-5 right-5"), false);
  assert.equal(profileSource.includes('setNickname(settings?.nickname ?? "")'), true);
  assert.equal(profileSource.includes("settings?.nickname || randomNickname()"), false);
});

test("Windows package keeps only needed locales and recording no longer ships ffprobe", () => {
  const installerSource = readFileSync(installerPath, "utf8");
  const packageSource = readFileSync(path.resolve(process.cwd(), "package.json"), "utf8");
  const recordingSource = readFileSync(recordingMainPath, "utf8");

  assert.equal(installerSource.includes("electronLanguages:"), true);
  assert.equal(installerSource.includes("- zh-CN"), true);
  assert.equal(packageSource.includes('"ffprobe-static"'), false);
  assert.equal(recordingSource.includes('from "ffprobe-static"'), false);
});
