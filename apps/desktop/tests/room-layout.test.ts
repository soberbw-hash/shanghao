import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const overlayWindowPath = path.resolve(process.cwd(), "src/main/overlay-window.ts");
const overlayPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/OverlayPage.tsx");
const rendererMainPath = path.resolve(process.cwd(), "src/renderer/src/main.tsx");
const stylesPath = path.resolve(process.cwd(), "src/renderer/src/styles/index.css");
const chatPanelPath = path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx");
const teamIslandPath = path.resolve(process.cwd(), "src/renderer/src/components/room/TeamIsland.tsx");
const sceneZonesPath = path.resolve(process.cwd(), "src/renderer/src/features/voice-scene/sceneZones.ts");
const sharedOverlaysPath = path.resolve(process.cwd(), "src/renderer/src/pages/SharedOverlays.tsx");
const installerPath = path.resolve(process.cwd(), "electron-builder.yml");

test("room page uses the V5 island, light responses, and voice dock", () => {
  const source = readFileSync(roomPagePath, "utf8");

  assert.equal(source.includes("TemporaryChatPanel"), true);
  assert.equal(source.includes("TeamIsland"), true);
  assert.equal(source.includes("desktopApi.overlay.toggle"), true);
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
  assert.equal(overlaySource.includes("OVERLAY_SHADOW_MARGIN = 6"), true);
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
  assert.equal(sceneZonesSource.includes("coffeeBar"), true);
  assert.equal(sceneZonesSource.includes("restroomZone"), true);
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

  assert.equal(stylesSource.includes("object-position: center 60%"), true);
  assert.equal(stylesSource.includes("transform: scale(1.01)"), true);
  assert.equal(sceneZonesSource.includes("gameDesk5: { left: 86, top: 88"), true);
  assert.equal(sceneZonesSource.includes("gameDesk4: { left: 42, top: 89"), true);
  assert.equal(sceneZonesSource.includes("gameDesk1: { left: 33, top: 53"), true);
});
