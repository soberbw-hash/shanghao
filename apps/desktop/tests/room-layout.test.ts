import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const installerPath = path.resolve(process.cwd(), "electron-builder.yml");

test("room page uses the V5 island, light responses, and voice dock", () => {
  const source = readFileSync(roomPagePath, "utf8");

  assert.equal(source.includes("TemporaryChatPanel"), true);
  assert.equal(source.includes("TeamIsland"), true);
  assert.equal(source.includes("FloatingBuddyBar"), true);
  assert.equal(source.includes("voice-dock"), true);
  assert.equal(source.includes("房间地址"), false);
  assert.equal(source.includes("连接方式"), false);
  assert.equal(source.includes("进入开黑频道"), false);
});

test("desktop build includes custom nsis shortcut icon wiring", () => {
  const source = readFileSync(installerPath, "utf8");

  assert.equal(source.includes("include: build/installer.nsh"), true);
  assert.equal(source.includes("shanghao-shortcut-v3.ico"), true);
});
