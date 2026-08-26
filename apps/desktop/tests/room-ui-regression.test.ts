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
import { memberStatus } from "../src/renderer/src/features/voice-scene/activityRules";
import { stabilizePeerLatency, useRoomStore } from "../src/renderer/src/store/roomStore";
import { getNicknameValidationError } from "../src/renderer/src/utils/nickname";
import { readRendererCss } from "./helpers/read-renderer-css";

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

test("updating members are distinct from reconnecting members", () => {
  assert.equal(
    memberStatus({ ...member(), presenceState: MemberPresenceState.Updating }).label,
    "正在更新",
  );
  assert.equal(
    memberStatus({ ...member(), presenceState: MemberPresenceState.Reconnecting }).label,
    "正在回来",
  );
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

test("room exposes one dedicated AI entry with suggestions, prompt and history states", () => {
  const windowFrameSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/layout/WindowFrame.tsx"),
    "utf8",
  );
  const roomSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx"),
    "utf8",
  );
  const chatSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx"),
    "utf8",
  );
  const dialogSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomAskDialog.tsx"),
    "utf8",
  );
  assert.equal(windowFrameSource.includes('aria-label="打开上号 AI"'), false);
  assert.equal(windowFrameSource.includes('className="window-ai-zone"'), false);
  assert.equal(windowFrameSource.includes('className="window-ai-entry whitespace-nowrap"'), false);
  assert.equal(chatSource.includes('className="chat-ai-entry interactive-surface"'), true);
  assert.equal(chatSource.includes('aria-label="打开上号 AI"'), true);
  assert.equal(chatSource.includes('<Bot className="h-4 w-4"'), true);
  assert.equal(windowFrameSource.includes("shanghao:open-room-ai"), false);
  assert.equal(roomSource.includes("shanghao:open-room-ai"), true);
  assert.equal(dialogSource.includes("搜索记忆"), false);
  assert.equal(dialogSource.includes("房间云端 AI，可联网搜索相关知识"), false);
  assert.equal(dialogSource.includes("ROOM_QUESTION_HISTORY_LIMIT = 10"), true);
  assert.equal(dialogSource.includes("ROOM_QUESTION_SUGGESTIONS"), true);
  assert.equal(dialogSource.includes("海克斯大乱斗卡莎出装推荐"), true);
  assert.equal(dialogSource.includes("三角洲行动零号大坝撤离路线"), false);
  assert.equal(dialogSource.includes("联网查游戏攻略和资料"), true);
  assert.equal(dialogSource.includes("可以问当前房间，也可以查找录音里的内容。"), false);
  assert.equal(dialogSource.includes("今天想问点什么？"), true);
  assert.equal(dialogSource.includes('className="room-ai-composer"'), true);
  assert.equal(dialogSource.includes('aria-label="发送问题"'), true);
  assert.equal(dialogSource.includes('aria-label="最近提问"'), true);
  assert.equal(dialogSource.includes("问千问"), false);
  assert.equal(dialogSource.includes("window.desktopApi.ai.askMemory"), true);
  assert.equal(dialogSource.includes("window.desktopApi.ai.cancelQuestion"), true);
  assert.equal(dialogSource.includes("停止回答"), true);
  assert.equal(dialogSource.includes("onOpenResult"), true);
  assert.equal(dialogSource.includes('className="room-ask-popover"'), true);
  assert.equal(dialogSource.includes("需要先在设置的 AI 功能里下载问答模型"), false);
  assert.equal(dialogSource.includes('aria-modal="true"'), false);
  assert.equal(dialogSource.includes("fixed inset-0"), false);
});

test("room actions follow status, interaction, tools and safe-exit hierarchy", () => {
  const topbarSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/layout/TopStatusBar.tsx"),
    "utf8",
  );
  const dockSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomDock.tsx"),
    "utf8",
  );
  const stylesSource = readRendererCss(process.cwd());

  const topbarOrder = [
    'className="topbar-metrics"',
    'data-icon-motion="knock"',
    'data-icon-motion="invite"',
    'data-icon-motion="settings"',
  ].map((marker) => topbarSource.indexOf(marker));
  assert.equal(
    topbarOrder.every((position) => position >= 0),
    true,
  );
  assert.deepEqual(
    topbarOrder,
    [...topbarOrder].sort((left, right) => left - right),
  );
  assert.equal(topbarSource.includes('aria-label="投喂作者"'), false);
  assert.equal(topbarSource.includes('aria-label="打开上号 AI"'), false);

  const dockOrder = [
    'className="voice-action-group voice-session-actions"',
    'data-icon-motion="screen-share"',
    "<RecordingButton",
    'className="voice-action-group voice-window-actions"',
    'className="voice-action-group voice-exit-actions"',
    'data-icon-motion="exit"',
  ].map((marker) => dockSource.indexOf(marker));
  assert.equal(
    dockOrder.every((position) => position >= 0),
    true,
  );
  assert.deepEqual(
    dockOrder,
    [...dockOrder].sort((left, right) => left - right),
  );
  assert.match(
    stylesSource,
    /\.voice-window-actions,\s*\.voice-exit-actions\s*\{[^}]*border-left:/s,
  );
});

test("room floating chrome keeps the requested static glass hierarchy", () => {
  const stylesSource = readRendererCss(process.cwd());

  assert.equal(stylesSource.includes(".room-page .voice-dock {"), true);
  assert.equal(stylesSource.includes("blur(20px) saturate(138%)"), true);
  assert.equal(stylesSource.includes(".room-page .room-topbar {"), true);
  assert.equal(stylesSource.includes("blur(17px) saturate(132%)"), true);
  assert.equal(stylesSource.includes(".room-page .audio-control-popover {"), true);
  assert.equal(stylesSource.includes("blur(22px) saturate(142%)"), true);
  assert.equal(stylesSource.includes("blur(32px) saturate(138%)"), true);
  assert.equal(stylesSource.includes(".room-page.performance-gaming"), false);
});

test("room center material stays static, clean and separated from the workstations", () => {
  const stylesSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/styles/parts/130-final-material.css"),
    "utf8",
  );

  assert.match(stylesSource, /\.team-island-stage::after \{[^}]*opacity: 0\.012;/);
  assert.match(stylesSource, /\.scene-window-light \{[^}]*filter: none;/);
  assert.match(stylesSource, /\.scene-rug \{[^}]*border-radius: 50%;/);
  assert.match(stylesSource, /\.scene-brand-arc \{[^}]*width: clamp\(72px, 7%, 104px\);/);
  assert.match(stylesSource, /\.scene-desk-shadow,[^{]*\{[^}]*filter: none;/);
  assert.doesNotMatch(
    stylesSource,
    /\.team-island-stage::after \{[^}]*(?:animation|backdrop-filter):/,
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
  const signalingErrorPolicy = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/room/signalingErrorPolicy.ts"),
    "utf8",
  );
  assert.equal(capabilities.includes('DAILY_ROOM_REPORTS_MIN_BUILD = "2026.08.12.1"'), true);
  assert.equal(
    source.includes("serverBuildSupportsDailyRoomReports(this.serverBuildNumber)"),
    true,
  );
  assert.equal(
    signalingErrorPolicy.includes(
      'payload.code === "invalid_payload" && context.hasJoinedOnce && context.joinAckReceived',
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

  const clientSource = readFileSync(
    path.resolve(
      process.cwd(),
      "src/renderer/src/features/screen-share/RoomScreenShareCoordinator.ts",
    ),
    "utf8",
  );
  const viewModelSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/room/roomViewModel.ts"),
    "utf8",
  );
  assert.equal(viewModelSource.includes("!remoteSharing[peerId]"), true);
  assert.equal(clientSource.includes("onRemoteState(payload.peerId, true)"), true);
  assert.equal(clientSource.includes("onRemoteState(payload.peerId, false)"), true);
});

test("collection composer is fixed-size and primary audio controls use matching crisp icons", () => {
  const styles = readRendererCss();
  const muteButton = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/audio/MuteButton.tsx"),
    "utf8",
  );
  const roomSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomDock.tsx"),
    "utf8",
  );
  const roomPageSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx"),
    "utf8",
  );
  assert.match(styles, /\.collection-composer textarea \{[\s\S]*?resize: none;/);
  assert.equal(muteButton.includes('name="mic" muted={isMuted}'), true);
  assert.equal(roomSource.includes('name="speaker"'), true);
  assert.equal(roomSource.includes("muted={isDeafened}"), true);
  assert.equal(roomSource.includes("data-gsap-voice"), false);
  assert.equal(roomPageSource.includes("[data-gsap-voice='primary']"), false);
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
  const styles = readRendererCss();

  assert.equal(chatSource.includes('latestMessage?.isLocal ? "auto" : "smooth"'), true);
  assert.equal(chatSource.includes("list.scrollTop = list.scrollHeight"), true);
  assert.match(styles, /\.chat-message-list \{[\s\S]*?padding-bottom: 12px;/);
  assert.equal(styles.includes("contain-intrinsic-size: auto 64px"), false);
});

test("fast chat acknowledgements do not flash a transient sending label", () => {
  const chatSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx"),
    "utf8",
  );

  assert.equal(chatSource.includes("发送中…"), false);
  assert.equal(chatSource.includes("发送失败 · 重新发送"), true);
});

test("the shanghao quick reply uses its own voice sound for every avatar", () => {
  const soundSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/audio/quickMessageAudio.ts"),
    "utf8",
  );
  const roomStateSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts"),
    "utf8",
  );

  assert.equal(soundSource.includes('soundId === "legacy-animal-call"'), true);
  assert.equal(soundSource.includes("playAnimalCall"), true);
  assert.equal(roomStateSource.includes("message.content,"), true);
  assert.equal(
    roomStateSource.includes("currentSettings?.quickMessages.soundEnabled !== false"),
    true,
  );
  assert.equal(roomStateSource.includes("sendConfiguredQuickMessage"), true);
  assert.equal(roomStateSource.includes("currentSettings.quickMessages.soundVolume"), true);
});

test("the seated duck stays centered over its compact chair", () => {
  const styles = readRendererCss();

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

test("speaker controls expose friend loudness balance without replacing per-friend volume", () => {
  const popover = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/audio/AudioControlPopover.tsx"),
    "utf8",
  );
  const dock = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomDock.tsx"),
    "utf8",
  );
  assert.equal(popover.includes("好友响度平衡"), true);
  assert.equal(popover.includes("自动缩小忽大忽小的音量差异"), true);
  assert.equal(popover.includes("LUFS"), false);
  assert.equal(dock.includes("settings.isFriendLoudnessBalanceEnabled"), true);
  assert.equal(dock.includes("打开扬声器设备、好友响度平衡与总音量"), true);
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

test("chat image preview keeps large navigation controls fixed at the left and right sides", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/ChatImageLightbox.tsx"),
    "utf8",
  );
  const styles = readRendererCss();

  assert.equal(source.includes('aria-label="查看上一张图片"'), true);
  assert.equal(source.includes('aria-label="查看下一张图片"'), true);
  assert.equal(source.includes("getSpatialTransform"), true);
  assert.equal(source.includes("originElement.getBoundingClientRect()"), true);
  assert.equal(source.includes("onComplete: onClosed"), true);
  assert.match(styles, /\.chat-image-preview-nav\s*\{[^}]*position:\s*fixed;/s);
  assert.match(styles, /\.chat-image-preview-nav\s*\{[^}]*width:\s*54px;[^}]*height:\s*54px;/s);
  assert.match(styles, /\.chat-image-preview-nav\.is-previous\s*\{[^}]*left:/s);
  assert.match(styles, /\.chat-image-preview-nav\.is-next\s*\{[^}]*right:/s);
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
  assert.equal(roomStateSource.includes("preserveLocalMedia: reuseLocalMedia"), true);
  assert.equal(roomStateSource.includes("reuseExisting: reuseLocalMedia"), true);
  assert.equal(roomPageSource.includes("key={room.roomId}"), false);
  assert.equal(roomStateSource.includes("previousMemberIds = new Set<string>();"), true);
});

test("image-heavy overlays avoid scale repaints and defer offscreen image decoding", () => {
  const overlaysSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomOverlays.tsx"),
    "utf8",
  );
  const motionSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/motion/motionPresets.ts"),
    "utf8",
  );
  const styles = readRendererCss();

  assert.equal(overlaysSource.includes("largeDialogSurfaceVariants"), true);
  assert.equal(overlaysSource.includes('decoding="async"'), true);
  assert.equal(overlaysSource.includes('fetchPriority="low"'), true);
  assert.equal(overlaysSource.includes("COLLECTION_RENDER_BATCH_SIZE = 24"), true);
  assert.equal(overlaysSource.includes("orderedItems.slice(0, visibleItemCount)"), true);
  assert.equal(overlaysSource.includes("sources.slice(0, 24)"), true);
  assert.equal(motionSource.includes("export const largeDialogSurfaceVariants"), true);
  const largeDialogVariants = motionSource.slice(
    motionSource.indexOf("export const largeDialogSurfaceVariants"),
    motionSource.indexOf("export const popoverSurfaceVariants"),
  );
  assert.equal(largeDialogVariants.includes("scale:"), false);
  assert.match(styles, /\.screen-source-picker-item\s*\{[^}]*content-visibility:\s*auto;/s);
  assert.equal(styles.includes(".team-island.is-visual-motion-paused *\n"), false);
});

test("stopping a recording suppresses automatic restart for the current room", () => {
  const roomPageSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx"),
    "utf8",
  );
  const finalizeBlock = roomPageSource.slice(
    roomPageSource.indexOf("const finalizeRecording"),
    roomPageSource.indexOf("const changeRecordingDirectory"),
  );

  assert.equal(roomPageSource.includes("const isAutoRecordSuppressedRef = useRef(false)"), true);
  assert.equal(roomPageSource.includes("isAutoRecordSuppressedRef.current = false"), true);
  assert.equal(
    roomPageSource.includes(
      "!canAutoRecord || hasAutoStartedRecordingRef.current || isAutoRecordSuppressedRef.current",
    ),
    true,
  );
  assert.equal(finalizeBlock.includes('if (intent === "stop")'), true);
  assert.equal(finalizeBlock.includes("isAutoRecordSuppressedRef.current = true"), true);
  assert.equal(
    finalizeBlock.includes("window.clearTimeout(autoRecordRetryTimerRef.current)"),
    true,
  );
  assert.equal(
    finalizeBlock.indexOf("isAutoRecordSuppressedRef.current = true") <
      finalizeBlock.indexOf("await discardRecording()"),
    true,
  );
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
