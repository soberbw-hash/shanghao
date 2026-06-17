import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const overlayWindowPath = path.resolve(process.cwd(), "src/main/overlay-window.ts");
const chatPanelPath = path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx");
const teamIslandPath = path.resolve(process.cwd(), "src/renderer/src/components/room/TeamIsland.tsx");
const sceneZonesPath = path.resolve(process.cwd(), "src/renderer/src/features/voice-scene/sceneZones.ts");
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
  const chatSource = readFileSync(chatPanelPath, "utf8");
  const teamIslandSource = readFileSync(teamIslandPath, "utf8");
  const sceneZonesSource = readFileSync(sceneZonesPath, "utf8");

  assert.equal(roomSource.includes("KNOCK_COOLDOWN_MS = 5_000"), true);
  assert.equal(roomSource.includes("desktopApi.overlay.toggle"), true);
  assert.equal(overlaySource.includes("alwaysOnTop: true"), true);
  assert.equal(overlaySource.includes("skipTaskbar: true"), true);
  assert.equal(overlaySource.includes("overlay-bounds.json"), true);
  assert.equal(overlaySource.includes("width: 56"), true);
  assert.equal(overlaySource.includes("resizable: false"), true);
  assert.equal(chatSource.includes('message.kind === "system"'), true);
  assert.equal(chatSource.includes("AvatarPlaceholder"), true);
  assert.equal(teamIslandSource.includes("scene-zone-hotspot"), true);
  assert.equal(sceneZonesSource.includes("coffeeBar"), true);
  assert.equal(sceneZonesSource.includes("restroomZone"), true);
  assert.equal(teamIslandSource.includes("scale: ["), false);
});

test("desktop build includes custom nsis shortcut icon wiring", () => {
  const source = readFileSync(installerPath, "utf8");

  assert.equal(source.includes("include: build/installer.nsh"), true);
  assert.equal(source.includes("shanghao-shortcut-v3.ico"), true);
});
