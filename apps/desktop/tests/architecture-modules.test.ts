import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve(process.cwd(), "src/renderer/src");
const read = (relativePath: string) => readFileSync(path.join(sourceRoot, relativePath), "utf8");

test("RoomClient remains the stable facade while mature responsibilities are delegated", () => {
  const roomClient = read("features/room/roomClient.ts");
  const chatTransport = read("features/chat/ReliableChatTransport.ts");
  const socialTransport = read("features/chat/RoomSocialTransport.ts");
  const signalingBridge = read("features/room/SignalingBridge.ts");
  const presenceCoordinator = read("features/room/PresenceCoordinator.ts");
  const peerRecoveryCoordinator = read("features/room/PeerRecoveryCoordinator.ts");
  const memberEventCoordinator = read("features/room/RoomMemberEventCoordinator.ts");
  const screenAudioMixer = read("features/screen-share/ScreenAudioMixer.ts");
  const screenShareCoordinator = read("features/screen-share/RoomScreenShareCoordinator.ts");
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
  assert.match(roomClient, /new RoomSocialTransport/);
  assert.match(roomClient, /new SignalingBridge/);
  assert.match(roomClient, /new PresenceCoordinator/);
  assert.match(roomClient, /new PeerRecoveryCoordinator/);
  assert.match(roomClient, /new RoomMemberEventCoordinator/);
  assert.match(roomClient, /new ScreenAudioMixer/);
  assert.match(roomClient, /new RoomScreenShareCoordinator/);
  assert.doesNotMatch(roomClient, /new ScreenFrameRelay/);
  assert.doesNotMatch(roomClient, /peerRecoveryTimers/);
  assert.doesNotMatch(roomClient, /pendingSends = new Map/);
  assert.doesNotMatch(roomClient, /document\.createElement\("canvas"\)/);
  assert.match(chatTransport, /clientMessageId/);
  assert.match(chatTransport, /handleAck/);
  assert.match(socialTransport, /addCollection/);
  assert.match(socialTransport, /removeCollection/);
  assert.match(signalingBridge, /eventQueue/);
  assert.match(presenceCoordinator, /async publish\(\)/);
  assert.match(presenceCoordinator, /lastPublishedKey/);
  assert.match(peerRecoveryCoordinator, /sendIceRestartOffer/);
  assert.match(peerRecoveryCoordinator, /scheduleRebuild/);
  assert.match(memberEventCoordinator, /handleMemberState/);
  assert.match(memberEventCoordinator, /handleAvatar/);
  assert.match(
    roomClient,
    /this\.memberEvents\.updateLocalPresence\([\s\S]*this\.presenceCoordinator\.update\(/,
  );
  assert.match(screenAudioMixer, /systemGain\.gain\.value = 0\.72/);
  assert.doesNotMatch(roomClient, /createMediaStreamDestination/);
  assert.match(screenShareCoordinator, /new ScreenFrameRelay/);
  assert.match(screenFrameRelay, /screen_frame/);
});

test("RoomPage composes extracted regions without changing their user-facing contracts", () => {
  const roomPage = read("pages/RoomPage.tsx");
  const roomDock = read("components/room/RoomDock.tsx");
  const roomOverlays = read("components/room/RoomOverlays.tsx");
  const screenPanel = read("components/room/ScreenSharePanel.tsx");
  const audioPopover = read("components/audio/AudioControlPopover.tsx");

  assert.match(roomPage, /import \{ ScreenSharePanelContainer \}/);
  assert.match(roomPage, /import \{ RoomDock(?:,| \})/);
  assert.match(roomPage, /from "\.\.\/components\/room\/RoomOverlays"/);
  assert.doesNotMatch(roomPage, /import \{ AudioControlPopover \}/);
  assert.doesNotMatch(roomPage, /const ScreenShareVideo =/);
  assert.doesNotMatch(roomPage, /const AudioControlPopover =/);
  assert.match(roomDock, /import \{ AudioControlPopover \}/);
  assert.match(roomOverlays, /export const ScreenSourcePicker/);
  assert.match(screenPanel, /data-testid="screen-share-panel"/);
  assert.match(audioPopover, /referenceValue=\{1\}/);
});

test("Room facade and page composition stay below their reviewed growth ceilings", () => {
  const roomClientLines = read("features/room/roomClient.ts").split(/\r?\n/).length;
  const roomPageLines = read("pages/RoomPage.tsx").split(/\r?\n/).length;

  // RoomClient stopped at the safe responsibility boundary instead of moving
  // tightly coupled peer/audio glue into a meaningless helper solely for a metric.
  // 3.0.2 also keeps the tightly coupled superseded-session shutdown and
  // connected-but-quiet peer recovery ownership in this facade. The recognition
  // policy remains extracted while resource disposal stays beside its owners.
  assert.ok(roomClientLines <= 1660, `RoomClient grew to ${roomClientLines} lines`);
  // The reviewed ceiling includes the current room pressure/collection wiring while
  // the dock and overlays remain extracted from the page.
  assert.ok(roomPageLines <= 1515, `RoomPage grew to ${roomPageLines} lines`);
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
