import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve(process.cwd(), "src/renderer/src");
const read = (relativePath: string) => readFileSync(path.join(sourceRoot, relativePath), "utf8");

test("RoomClient remains the stable facade while mature responsibilities are delegated", () => {
  const roomClient = read("features/room/roomClient.ts");
  const chatTransport = read("features/chat/ReliableChatTransport.ts");
  const signalingBridge = read("features/room/SignalingBridge.ts");
  const screenAudioMixer = read("features/screen-share/ScreenAudioMixer.ts");
  const screenFrameRelay = read("features/screen-share/ScreenFrameRelay.ts");

  assert.match(roomClient, /export class RoomClient/);
  for (const publicMethod of [
    "connect",
    "disconnect",
    "sendChatMessage",
    "startScreenShare",
    "stopScreenShare",
  ]) {
    assert.match(roomClient, new RegExp(`\\b${publicMethod}\\(`));
  }
  assert.match(roomClient, /new ReliableChatTransport/);
  assert.match(roomClient, /new SignalingBridge/);
  assert.match(roomClient, /new ScreenAudioMixer/);
  assert.match(roomClient, /new ScreenFrameRelay/);
  assert.doesNotMatch(roomClient, /pendingSends = new Map/);
  assert.doesNotMatch(roomClient, /document\.createElement\("canvas"\)/);
  assert.match(chatTransport, /clientMessageId/);
  assert.match(chatTransport, /handleAck/);
  assert.match(signalingBridge, /eventQueue/);
  assert.match(screenAudioMixer, /systemGain\.gain\.value = 0\.72/);
  assert.doesNotMatch(roomClient, /createMediaStreamDestination/);
  assert.match(screenFrameRelay, /screen_frame/);
});

test("RoomPage composes extracted regions without changing their user-facing contracts", () => {
  const roomPage = read("pages/RoomPage.tsx");
  const screenPanel = read("components/room/ScreenSharePanel.tsx");
  const audioPopover = read("components/audio/AudioControlPopover.tsx");

  assert.match(roomPage, /import \{ ScreenSharePanel \}/);
  assert.match(roomPage, /import \{ AudioControlPopover \}/);
  assert.doesNotMatch(roomPage, /const ScreenShareVideo =/);
  assert.doesNotMatch(roomPage, /const AudioControlPopover =/);
  assert.match(screenPanel, /data-testid="screen-share-panel"/);
  assert.match(audioPopover, /referenceValue=\{1\}/);
});

test("useRoomState delegates persistence, notifications and deep links", () => {
  const hook = read("hooks/useRoomState.ts");
  assert.match(hook, /from "\.\.\/features\/chat\/chatPersistence"/);
  assert.match(hook, /from "\.\.\/features\/room\/memberVolumePersistence"/);
  assert.match(hook, /from "\.\.\/features\/room\/roomNotifications"/);
  assert.match(hook, /useRoomDeepLink\(/);
  assert.doesNotMatch(hook, /chatHistoryWriteQueue/);
  assert.doesNotMatch(hook, /desktopApi\?\.app\?\.onDeepLink/);
});
