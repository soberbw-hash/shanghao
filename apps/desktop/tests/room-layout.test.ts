import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const roomPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const installerPath = path.resolve(process.cwd(), "electron-builder.yml");

test("room page keeps the right column dedicated to temporary chat", () => {
  const source = readFileSync(roomPagePath, "utf8");

  assert.equal(source.includes("TemporaryChatPanel"), true);
  assert.equal(source.includes("xl:grid-cols-[1.15fr_0.85fr]"), true);
  assert.equal(source.includes("房间地址"), true);
  assert.equal(source.includes("连接方式"), true);
});

test("desktop build includes custom nsis shortcut icon wiring", () => {
  const source = readFileSync(installerPath, "utf8");

  assert.equal(source.includes("include: build/installer.nsh"), true);
  assert.equal(source.includes("shanghao-shortcut.ico"), true);
});
