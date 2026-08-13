import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  type RoomMember,
} from "@private-voice/shared";

import { seatSlots } from "../src/renderer/src/features/voice-scene/sceneZones";
import { stabilizePeerLatency, useRoomStore } from "../src/renderer/src/store/roomStore";
import { getNicknameValidationError } from "../src/renderer/src/utils/nickname";

const member = (latencyMs?: number): RoomMember => ({
  id: "peer-latency",
  nickname: "朋友",
  isHost: false,
  isLocal: false,
  isMuted: false,
  isDeafened: false,
  activity: "idle",
  sceneZone: "gameDesk2",
  latencyMs,
  presenceState: MemberPresenceState.Online,
  speakingState: MemberSpeakingState.Silent,
  joinState: MemberJoinState.Joined,
  volume: 1,
  joinedAt: "2026-07-13T00:00:00.000Z",
  connectionQuality: "good",
});

test("seat state updates preserve the last valid peer latency", () => {
  useRoomStore.getState().resetRoom();
  useRoomStore.getState().setMembers([member(32)]);
  useRoomStore.getState().setMembers([{ ...member(), sceneZone: "gameDesk3" }]);
  const updated = useRoomStore
    .getState()
    .room.members.find((candidate) => candidate.id === "peer-latency");
  assert.equal(updated?.latencyMs, 32);
  assert.equal(updated?.sceneZone, "gameDesk3");
});

test("peer latency keeps the last value and smooths noisy measurements", () => {
  assert.equal(stabilizePeerLatency(48, undefined), 48);
  assert.equal(stabilizePeerLatency(48, Number.NaN), 48);
  assert.equal(stabilizePeerLatency(48, 51), 48);
  assert.equal(stabilizePeerLatency(48, 88), 59);

  useRoomStore.getState().resetRoom();
  useRoomStore.getState().setMembers([member(48)]);
  useRoomStore.getState().updatePeerLatency("peer-latency", undefined);
  assert.equal(
    useRoomStore.getState().room.members.find((candidate) => candidate.id === "peer-latency")
      ?.latencyMs,
    48,
  );
});

test("ordinary workstation selection is idle until a real game is detected", () => {
  assert.equal(
    seatSlots.every((slot) => slot.activity === "idle"),
    true,
  );
});

test("local speaker and microphone state are applied atomically before server echoes", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts"),
    "utf8",
  );
  assert.equal(source.includes("speakingState: isMuted"), true);
  assert.equal(source.includes("activeClient?.updateMuteState(isMuted, isSpeaking)"), true);
  assert.equal(source.includes("updateLocalPresence({\n          speakingState: muted"), true);
  assert.equal(source.includes("isMuted: audioState.isMuted"), true);
  assert.equal(source.includes("isDeafened: audioState.isDeafened"), true);
});

test("speaking state changes never move the local character to another seat", () => {
  useRoomStore.getState().resetRoom();
  useRoomStore.getState().setMembers([
    {
      ...member(36),
      id: "local-speaker",
      isLocal: true,
      sceneZone: "gameDesk4",
    },
  ]);

  useRoomStore.getState().updateLocalPresence({
    speakingState: MemberSpeakingState.Speaking,
  });

  const local = useRoomStore.getState().room.members.find((candidate) => candidate.isLocal);
  assert.equal(local?.sceneZone, "gameDesk4");

  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx"),
    "utf8",
  );
  assert.equal(source.includes("[localMember]"), false);
  assert.equal(source.includes("localMember?.sceneZone"), true);
});

test("new additive room requests are not sent to the deployed 2.5 server", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/room/roomClient.ts"),
    "utf8",
  );
  const capabilities = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/chat/serverCapabilities.ts"),
    "utf8",
  );
  const chatTransport = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/chat/ReliableChatTransport.ts"),
    "utf8",
  );
  assert.equal(capabilities.includes('DAILY_ROOM_REPORTS_MIN_BUILD = "2026.08.12.1"'), true);
  assert.equal(
    source.includes("serverBuildSupportsDailyRoomReports(this.serverBuildNumber)"),
    true,
  );
  assert.equal(
    source.includes(
      'payload.code === "invalid_payload" && this.hasJoinedOnce && this.joinAckReceived',
    ),
    true,
  );
  assert.equal(capabilities.includes('RELIABLE_CHAT_ACK_MIN_BUILD = "2026.08.12.1"'), true);
  assert.equal(
    chatTransport.includes("serverBuildSupportsReliableChat(this.options.getServerBuildNumber())"),
    true,
  );
  assert.equal(chatTransport.includes("scheduleLegacyConfirmation"), true);
  assert.equal(chatTransport.includes("findLegacyPending"), true);
  assert.equal(chatTransport.includes("legacy_chat_confirmation_lost"), true);
  assert.equal(
    capabilities.includes("serverBuildAtLeast(buildNumber, RELIABLE_CHAT_ACK_MIN_BUILD)"),
    true,
  );
});

test("screen-share UI requires an explicit current-room sharing announcement", () => {
  useRoomStore.getState().resetRoom();
  useRoomStore.getState().setRemoteScreenSharing("peer-screen", true);
  assert.equal(useRoomStore.getState().remoteScreenSharing["peer-screen"], true);
  useRoomStore.getState().clearChannelContent();
  assert.equal(useRoomStore.getState().remoteScreenSharing["peer-screen"], undefined);

  const roomSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx"),
    "utf8",
  );
  const clientSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/room/roomClient.ts"),
    "utf8",
  );
  assert.equal(roomSource.includes("remoteScreenSharing[peerId] &&"), true);
  assert.equal(clientSource.includes("onRemoteScreenShareState(payload.peerId, true)"), true);
  assert.equal(clientSource.includes("onRemoteScreenShareState(payload.peerId, false)"), true);
});

test("collection composer is fixed-size and primary audio controls use matching crisp icons", () => {
  const styles = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/styles/index.css"),
    "utf8",
  );
  const muteButton = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/audio/MuteButton.tsx"),
    "utf8",
  );
  const roomSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx"),
    "utf8",
  );
  assert.match(styles, /\.collection-composer textarea \{[\s\S]*?resize: none;/);
  assert.equal(muteButton.includes('className="voice-primary-icon"'), true);
  assert.equal(roomSource.includes('<Volume2 className="voice-primary-icon"'), true);
  assert.equal(roomSource.includes('<VolumeX className="voice-primary-icon"'), true);
});

test("chat history persists across updates and live messages use Windows notifications", () => {
  const roomStateSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts"),
    "utf8",
  );
  const preloadSource = readFileSync(path.resolve(process.cwd(), "src/preload/index.ts"), "utf8");
  const ipcSource = readFileSync(path.resolve(process.cwd(), "src/main/ipc.ts"), "utf8");
  const roomStoreSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/store/roomStore.ts"),
    "utf8",
  );
  const persistenceSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/chat/chatPersistence.ts"),
    "utf8",
  );

  assert.equal(roomStateSource.includes("readChatHistory({ serverUrl, channelId })"), true);
  assert.equal(
    persistenceSource.includes("saveChatHistory({ serverUrl, channelId, messages })"),
    true,
  );
  assert.equal(roomStoreSource.includes("MAX_LOCAL_CHAT_MESSAGES = 500"), true);
  assert.equal(roomStateSource.includes("title: `${message.nickname} 发来消息`"), true);
  assert.equal(preloadSource.includes("IPC_CHANNELS.app.readChatHistory"), true);
  assert.equal(ipcSource.includes('app.getPath("userData")'), true);
});

test("locally sent link previews stay fully visible above the composer", () => {
  const chatSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx"),
    "utf8",
  );

  assert.equal(chatSource.includes('latestMessage?.isLocal ? "auto" : "smooth"'), true);
  assert.equal(chatSource.includes("list.scrollTop = list.scrollHeight"), true);
});

test("the seated duck stays centered over its compact chair", () => {
  const styles = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/styles/index.css"),
    "utf8",
  );

  assert.match(
    styles,
    /\.desk-animal\[data-avatar-id="duck"\] \.desk-animal-chair \{[\s\S]*?left: 50%;[\s\S]*?width: 76px;[\s\S]*?height: 76px;/,
  );
  assert.doesNotMatch(
    styles,
    /\.desk-animal\[data-avatar-id="duck"\] \.desk-animal-chair \{[\s\S]*?left: 54%;/,
  );
});

test("volume sliders expose and snap to the 100 percent reference node", () => {
  const audioPopoverSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/audio/AudioControlPopover.tsx"),
    "utf8",
  );
  const characterSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/SceneCharacter.tsx"),
    "utf8",
  );
  const sliderSource = readFileSync(
    path.resolve(process.cwd(), "../../packages/ui/src/components/Slider.tsx"),
    "utf8",
  );

  assert.equal(audioPopoverSource.includes("referenceValue={1}"), true);
  assert.equal(characterSource.includes("referenceValue={100}"), true);
  assert.equal(sliderSource.includes("slider-reference-node"), true);
  assert.equal(sliderSource.includes("event.currentTarget.value = String(referenceValue)"), true);
});

test("abusive, suggestive and family-title nickname variants are rejected", () => {
  for (const nickname of [
    "daddy",
    "d@d",
    "D.A.D",
    "dad123",
    "yourdada123",
    "your-d4ddy-123",
    "ur_dad_777",
    "123dad",
    "d4d-123",
    "超级 D4ddy",
    "b-a-b-a",
    "m0mmy",
    "mom520",
    "粑粑",
    "拔拔",
    "爸 比",
    "霸币",
    "爹地",
    "父亲",
    "义-父",
    "爷爷",
    "叫我爸爸",
    "叫我奶奶",
    "煞笔",
    "n.m.s.l",
    "约炮",
    "p0rn",
    "习 近 平",
    "习近苹",
    "Xi-Jin-Ping",
    "xjp",
    "中国共产党",
    "8964",
  ]) {
    assert.ok(getNicknameValidationError(nickname));
  }
  assert.equal(getNicknameValidationError("摸鱼小猫"), undefined);
  assert.equal(getNicknameValidationError("Sober"), undefined);
  assert.equal(getNicknameValidationError("小习惯"), undefined);
  assert.equal(
    getNicknameValidationError("爸爸去哪儿"),
    "这个昵称包含不适合公开展示的内容，换一个正常称呼吧。",
  );
});

test("home avatar picker disables roles occupied on the fixed server", () => {
  const homeSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx"),
    "utf8",
  );
  const pickerSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/profile/AvatarPicker.tsx"),
    "utf8",
  );
  const relaySource = readFileSync(path.resolve(process.cwd(), "src/main/relay-status.ts"), "utf8");

  assert.equal(homeSource.includes("occupiedAvatarIds={occupiedAvatarIds}"), true);
  assert.equal(homeSource.includes("isSelectedAvatarOccupied"), true);
  assert.equal(pickerSource.includes("disabled={isOccupied}"), true);
  assert.equal(pickerSource.includes("已被朋友选择"), true);
  assert.equal(relaySource.includes("occupiedAvatarIds: health?.occupiedAvatarIds"), true);
});

test("chat messages are uniformly left aligned with avatar and no per-message clock", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx"),
    "utf8",
  );
  assert.equal(source.includes('message.isLocal ? "justify-end"'), false);
  assert.equal(source.includes("formatMessageTime"), false);
  assert.equal(source.includes("AvatarPlaceholder"), true);
  assert.equal(source.includes("chat-date-divider"), true);
  assert.equal(source.includes("animateSendFeedback"), true);
  assert.equal(source.includes('clearProps: "transform,opacity,visibility"'), true);
});

test("channel switching is exclusive and clears screen-share state before joining", () => {
  const roomPageSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx"),
    "utf8",
  );
  const roomStateSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts"),
    "utf8",
  );

  assert.equal(roomPageSource.includes("channelSwitchInFlightRef.current"), true);
  assert.equal(roomPageSource.includes("await shutdownScreenShare()"), true);
  assert.equal(
    roomPageSource.indexOf("await shutdownScreenShare()") <
      roomPageSource.indexOf("await switchChannel(channelId)"),
    true,
  );
  assert.equal(
    roomStateSource.includes("await cleanupPreviousSession();\n        clearChannelContent();"),
    true,
  );
  assert.equal(roomStateSource.includes("previousMemberIds = new Set<string>();"), true);
});

test("DeepFilterNet failure keeps the microphone live without interrupting the room", () => {
  const bootstrapSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useAppBootstrap.ts"),
    "utf8",
  );
  const processorSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/audio/microphoneProcessor.ts"),
    "utf8",
  );

  assert.equal(bootstrapSource.includes("shanghao:deepfilter-unavailable"), true);
  assert.equal(bootstrapSource.includes('pushToast({\n        tone: "warning"'), false);
  assert.equal(bootstrapSource.includes("prewarmDeepFilterAssets"), true);
  assert.equal(processorSource.includes("crossfade(context, processedGain, rawGain)"), true);
  assert.equal(processorSource.includes("ready: Promise<"), true);
  assert.equal(processorSource.includes("browser_fallback"), false);
});
