import { useCallback, useEffect, useRef } from "react";

import {
  isStoredRoomId,
  privateRoomInvitationUrl,
  isPrivateRoomId,
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  getQuickMessageShortcutSlots,
  findQuickMessagePreset,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
  type MemberActivity,
  type ChatImageAttachment,
  type RoomCollectionItem,
  type RoomMember,
  type RealtimeFaultCommand,
  type SceneZoneId,
  type SignalingEventPayload,
} from "@private-voice/shared";
import { createSpeakingDetector, type ScreenShareEncodingProfile } from "@private-voice/webrtc";
import { randomRoomAvatar } from "../features/room/randomRoomAvatar";
import { rememberRoomDirectory } from "../features/room/usePrivateRoomDirectory";

import {
  createProcessedMicrophoneStream,
  type ProcessedMicrophoneStream,
} from "../features/audio/microphoneProcessor";
import { acquireAudioSource, releaseAcquiredAudioSource } from "../features/audio/audioSource";
import { createAudioRuntimeSnapshot } from "../features/audio/audioRuntimeSnapshot";
import { PHONE_MIC_DEVICE_ID } from "../features/audio/phoneMicSource";
import { REMOTE_AUDIO_LEVEL_EVENT } from "../features/audio/RemoteAudioMixer";
import { getRemoteAudioMixer } from "../features/audio/RemoteAudioMixer";
import { clampMemberVolume } from "../features/audio/memberVolume";
import { playUiSound } from "../features/audio/uiSound";
import {
  getQuickMessageAudioSnapshot,
  muteQuickMessagePlayback,
  playQuickMessageSound,
  stopQuickMessageMusic,
  toggleQuickMessageMusic,
} from "../features/audio/quickMessageAudio";
import { RoomClient } from "../features/room/roomClient";
import { MemberPresenceTracker } from "../features/room/memberPresenceTracker";
import { finishOwnedRoomCleanup, RoomSessionOwnership } from "../features/room/sessionOwnership";
import {
  encodeQuickMessageControlTarget,
  encodeQuickMessageTarget,
  encodeQuickReplyTarget,
  presetForQuickReplyContent,
  QUICK_REPLY_COOLDOWN_MS,
  quickMessageCooldownMs,
} from "../features/chat/quickReplies";
import { persistChatHistory, type ChannelId } from "../features/chat/chatPersistence";
import {
  applyDefaultMemberVolumes,
  registerMemberVolumeReset,
  runtimeMemberVolumes,
  scheduleMemberVolumeSave,
} from "../features/room/memberVolumePersistence";
import {
  describeChatNotification,
  playSceneReactionSound,
  sendSystemNotification,
} from "../features/room/roomNotifications";
import { useAppStore } from "../store/appStore";
import { useAccountStore } from "../store/accountStore";
import { projectRoomMembers } from "../features/room/memberProjection";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { useDailyRoomReportStore } from "../store/dailyRoomReportStore";
import { writeRendererLog } from "../utils/logger";
import { shanghaoCore } from "../core/shanghaoCore";
import { privateRoomErrorMessage } from "../features/room/privateRoomMessages";
import { finishRoomRecordingBeforeRelease } from "../features/recording/roomRecordingOwnership";

let activeClient: RoomClient | null = null;
registerMemberVolumeReset(() => {
  const { room, updateMemberVolume } = useRoomStore.getState();
  applyDefaultMemberVolumes(room.members, (peerId, volume) => {
    updateMemberVolume(peerId, volume);
    activeClient?.setPeerVolume(peerId, volume);
  });
});
let activePeerId: string | undefined;
let activeJoinPromise: Promise<void> | null = null;
let activeSpeakingDetector: ReturnType<typeof createSpeakingDetector> | null = null;
let activeProcessedMicrophone: ProcessedMicrophoneStream | null = null;
let activeInputSourceId: string | undefined;
let inputDeviceSwitchQueue: Promise<unknown> = Promise.resolve();
let activeLeavePromise: Promise<void> | undefined;
const roomSessionOwnership = new RoomSessionOwnership();
let lastQuickMessageSentAt = 0;
let lastQuickMessageCooldownMs = 3_000;
type QuickMessageShortcutHandler = (slotIndex: number) => void;
let activeQuickMessageShortcutHandler: QuickMessageShortcutHandler | undefined;
const ROUTINE_SIGNAL_MESSAGE_TYPES = new Set([
  "audio_chunk",
  "member_state",
  "pong",
  "screen_frame",
]);

export const getRoomRuntimeDiagnostics = () => activeClient?.getDiagnostics();
export const getRoomSessionTimeline = () => roomSessionOwnership.snapshot();
export const getAudioRuntimeSnapshot = () => {
  const output = getRemoteAudioMixer().getDiagnostics();
  return createAudioRuntimeSnapshot({
    settings: useSettingsStore.getState().settings,
    appliedSourceId: activeInputSourceId,
    processorPresent: Boolean(activeProcessedMicrophone),
    processorDiagnostics: activeProcessedMicrophone?.processorDiagnostics,
    outputTrack: activeProcessedMicrophone?.stream.getAudioTracks()[0],
    roomClientPresent: Boolean(activeClient),
    appliedOutputDeviceId: output.appliedOutputDeviceId,
    outputRouteStatus: output.outputRouteStatus,
  });
};

export const retryActiveRoomConnection = (): boolean => activeClient?.retryReconnect() ?? false;

export const dispatchQuickMessageShortcut = (slotIndex: number): void => {
  activeQuickMessageShortcutHandler?.(slotIndex);
};

export const injectRealtimeFault = async (command: RealtimeFaultCommand): Promise<void> => {
  if (!activeClient) throw new Error("fault_lab_room_client_unavailable");
  await activeClient.injectFault(command);
};

const copy = {
  joinTitle: "进入频道失败",
  joinedTitle: "已进入开黑频道",
  joinedDescription: "好友上线后会自动出现在队伍里。",
  missingServerUrl: "还没有服务器地址，请先填写 ws:// 或 wss:// 开头的地址。",
  invalidServerUrl: "服务器地址要以 ws:// 或 wss:// 开头，不是 http://。",
  roomFull: "频道满了，最多 5 人同时语音。",
  networkFailed: "无法连接服务器，请检查地址、端口和防火墙。",
  socketClosed: "服务器连接被关闭，请确认服务端正在运行。",
  joinAckTimeout: "频道服务器已连接，但没有返回进房确认，请检查频道服务器是否已部署当前版本。",
  snapshotTimeout: "已进入频道，但同步成员超时，请重试。",
  versionMismatch: "当前版本太旧，请更新后再进入频道。",
  relayProtocolMismatch: "客户端与频道服务器版本不匹配，请更新频道服务器后再试。",
  relayAuthRequired: "频道服务器需要登录，请先登录上号账号。",
  relayAuthFailed: "登录状态已过期，请重新登录后再进入频道。",
  microphoneUnavailable: "麦克风不可用",
  microphonePermission:
    "麦克风访问未获允许。请在 Windows 设置 → 隐私和安全性 → 麦克风中开启麦克风访问及桌面应用访问，然后重启上号。",
  microphoneMissing: "没有找到可用的麦克风。",
  microphoneBusy: "麦克风暂时无法读取。请检查设备连接、RODE Connect 输入和是否被其他程序独占。",
  inputDeviceFailed: "输入设备切换失败",
  copiedInviteDescription: "把邀请发给朋友，点击链接或输入频道号即可加入。",
} as const;

const normalizeServerUrl = (value?: string): string => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error("missing_server_url");
  }

  const url = new URL(trimmed);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("invalid_server_url");
  }
  url.hash = "";
  return url.toString();
};

const normalizeRoomError = (error: unknown, fallback: string): string => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return copy.microphonePermission;
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return copy.microphoneMissing;
    }
    if (error.name === "NotReadableError") return copy.microphoneBusy;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message) return fallback;
    if (message === "missing_server_url") return copy.missingServerUrl;
    if (message === "invalid_server_url" || message === "Invalid URL") {
      return copy.invalidServerUrl;
    }
    if (message.includes("version")) return copy.versionMismatch;
    if (message === "relay_protocol_mismatch") return copy.relayProtocolMismatch;
    if (message === "relay_auth_required") return copy.relayAuthRequired;
    if (message === "relay_auth_failed") return copy.relayAuthFailed;
    if (message.includes("room_full")) return copy.roomFull;
    if (message === "avatar_taken") return "这个角色刚被朋友选走了，请换一个角色再进入频道。";
    if (message === "network_unreachable") return copy.networkFailed;
    if (message === "signaling_socket_closed") return copy.socketClosed;
    if (message === "join_ack_timeout") return copy.joinAckTimeout;
    if (message === "room_snapshot_timeout") return copy.snapshotTimeout;
    if (message === "signaling_not_connected") return "连接还没恢复，请稍后再试。";
    return message;
  }

  return fallback;
};

export const buildChannelInviteText = ({
  channelId,
  channelCode,
  roomName,
  serverUrl,
}: {
  channelId: string;
  channelCode: string;
  roomName: string;
  serverUrl?: string;
}) => {
  const link = privateRoomInvitationUrl({ roomId: channelId, channelCode, roomName, serverUrl });
  const title = roomName.replace(/[\r\n]/g, " ");
  return `来「${title}」一起上号\n频道号：${channelCode}\n点击加入：${link}\n也可在上号中输入频道号加入。`;
};

const summarizeSignalingEvent = (payload: SignalingEventPayload): Record<string, unknown> => {
  const summary: Record<string, unknown> = {
    bridgeEventType: payload.type,
    code: payload.code,
    reason: payload.reason,
    wasClean: payload.wasClean,
    message: payload.message,
  };

  if (payload.type !== "message" || !payload.data) {
    return summary;
  }

  summary.payloadBytes = new TextEncoder().encode(payload.data).byteLength;
  try {
    const message = JSON.parse(payload.data) as Record<string, unknown>;
    summary.messageType = message.type;
    summary.roomId = message.roomId;
    summary.peerId = message.peerId;
    summary.targetPeerId = message.targetPeerId;
    summary.revision = message.revision;
    summary.memberCount = Array.isArray(message.members) ? message.members.length : undefined;
    if (message.type === "error") {
      summary.serverErrorCode = message.code;
      summary.serverErrorMessage =
        typeof message.message === "string" ? message.message.slice(0, 240) : undefined;
    }
  } catch {
    summary.messageType = "invalid_json";
  }
  return summary;
};

export const useRoomState = () => {
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const accountDisplayName = useAccountStore((state) => state.snapshot.profile?.displayName);
  const room = useRoomStore((state) => state.room);
  const localStream = useRoomStore((state) => state.localStream);
  const setRoom = useRoomStore((state) => state.setRoom);
  const setMembers = useRoomStore((state) => state.setMembers);
  const setConnectionState = useRoomStore((state) => state.setConnectionState);
  const setLifecycleState = useRoomStore((state) => state.setLifecycleState);
  const setLocalStream = useRoomStore((state) => state.setLocalStream);
  const setRemoteStream = useRoomStore((state) => state.setRemoteStream);
  const setRemoteScreenFrame = useRoomStore((state) => state.setRemoteScreenFrame);
  const setRemoteScreenSharing = useRoomStore((state) => state.setRemoteScreenSharing);
  const setLocalScreenShareViewerPeerIds = useRoomStore(
    (state) => state.setLocalScreenShareViewerPeerIds,
  );
  const pushRoomEvent = useRoomStore((state) => state.pushRoomEvent);
  const clearRoomEvents = useRoomStore((state) => state.clearRoomEvents);
  const addChatMessage = useRoomStore((state) => state.addChatMessage);
  const updateChatDelivery = useRoomStore((state) => state.updateChatDelivery);
  const removeChatMessage = useRoomStore((state) => state.removeChatMessage);
  const mergeChatHistory = useRoomStore((state) => state.mergeChatHistory);
  const setCollectionItems = useRoomStore((state) => state.setCollectionItems);
  const mergeCollectionItems = useRoomStore((state) => state.mergeCollectionItems);
  const addSceneReaction = useRoomStore((state) => state.addSceneReaction);
  const addQuickMessage = useRoomStore((state) => state.addQuickMessage);
  const clearChannelContent = useRoomStore((state) => state.clearChannelContent);
  const setConnectionHealth = useRoomStore((state) => state.setConnectionHealth);
  const updatePeerLatency = useRoomStore((state) => state.updatePeerLatency);
  const updateMemberVolume = useRoomStore((state) => state.updateMemberVolume);
  const updateLocalPresence = useRoomStore((state) => state.updateLocalPresence);
  const setLocalDiagnostics = useAudioStore((state) => state.setLocalDiagnostics);
  const isMuted = useAudioStore((state) => state.isMuted);
  const isDeafened = useAudioStore((state) => state.isDeafened);
  const callModeActive = useAudioStore((state) => state.phoneModeActive);
  const pushToast = useAppStore((state) => state.pushToast);
  const setRoomAction = useAppStore((state) => state.setRoomAction);

  useEffect(() => {
    const localSpeakingState = useRoomStore
      .getState()
      .room.members.find((member) => member.isLocal)?.speakingState;
    const isSpeaking = !isMuted && localSpeakingState === MemberSpeakingState.Speaking;
    updateLocalPresence({
      callModeActive,
      isMuted,
      isDeafened,
      speakingState: isMuted
        ? MemberSpeakingState.Muted
        : isSpeaking
          ? MemberSpeakingState.Speaking
          : MemberSpeakingState.Silent,
    });
    const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
    activeClient?.updateMuteState(isMuted, isSpeaking);
    activeClient?.updatePresenceState(
      isDeafened,
      localMember?.activity ?? "idle",
      localMember?.sceneZone,
      localMember?.gameName,
      localMember?.musicActivity,
      localMember?.gameIconDataUrl,
      callModeActive,
    );
  }, [isDeafened, isMuted, callModeActive, updateLocalPresence]);

  const profileNickname = useSettingsStore(
    (state) => accountDisplayName || state.settings?.nickname,
  );
  const profileAvatarId = useSettingsStore((state) => state.settings?.avatarId);
  useEffect(() => {
    if (!profileNickname) return;

    activeClient?.updateProfile(
      profileNickname,
      avatarDataUrl,
      useRoomStore.getState().room.members.find((member) => member.isLocal)?.avatarId ??
        profileAvatarId,
    );
  }, [avatarDataUrl, profileAvatarId, profileNickname]);

  const startSpeakingDetector = (stream: MediaStream) => {
    const previousDetector = activeSpeakingDetector;
    activeSpeakingDetector = null;
    previousDetector?.destroy();
    const generation = roomSessionOwnership.current();
    // The detector may invoke a callback during construction; keep it unset
    // until construction finishes so that callback cannot acquire ownership.
    // eslint-disable-next-line prefer-const
    let detector: ReturnType<typeof createSpeakingDetector> | undefined;
    const ownsDetector = () =>
      roomSessionOwnership.owns(generation) && activeSpeakingDetector === detector;
    detector = createSpeakingDetector(
      stream,
      (isSpeaking) => {
        if (!ownsDetector()) return;
        const muted = useAudioStore.getState().isMuted;
        updateLocalPresence({
          speakingState: muted
            ? MemberSpeakingState.Muted
            : isSpeaking
              ? MemberSpeakingState.Speaking
              : MemberSpeakingState.Silent,
        });
        activeClient?.updateMuteState(muted, !muted && isSpeaking);
      },
      (level) => {
        if (!ownsDetector()) return;
        window.dispatchEvent(
          new CustomEvent(REMOTE_AUDIO_LEVEL_EVENT, {
            detail: { peerId: "local-member", level },
          }),
        );
      },
    );
    activeSpeakingDetector = detector;
  };

  const stopLocalMedia = () => {
    const detector = activeSpeakingDetector;
    activeSpeakingDetector = null;
    detector?.destroy();
    activeProcessedMicrophone?.dispose();
    activeProcessedMicrophone = null;
    useRoomStore
      .getState()
      .localStream?.getTracks()
      .forEach((track) => track.stop());
    setLocalStream(undefined);
    activeInputSourceId = undefined;
  };

  const cleanupPreviousSession = async ({
    resetStore = false,
    preserveLocalMedia = false,
  }: { resetStore?: boolean; preserveLocalMedia?: boolean } = {}) => {
    stopQuickMessageMusic();
    await finishRoomRecordingBeforeRelease().catch((error) => {
      pushToast({
        tone: "warning",
        title: "录音收尾失败",
        description: "请在录音库检查恢复结果，当前房间连接将安全关闭。",
      });
      void writeRendererLog("recording", "error", "room_recording_finalize_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    const generation = roomSessionOwnership.current();
    const client = activeClient;
    activeClient = null;
    activePeerId = undefined;
    if (client) roomSessionOwnership.record("disconnect_started", generation);
    await finishOwnedRoomCleanup(
      roomSessionOwnership,
      generation,
      async () => {
        if (client) await client.disconnect().catch(() => undefined);
      },
      () => {
        stopQuickMessageMusic();
        if (!preserveLocalMedia) stopLocalMedia();
        setConnectionHealth({ reconnectAttempt: 0 });
        if (resetStore) useRoomStore.getState().resetRoom();
      },
    );
    if (client) {
      roomSessionOwnership.record(
        roomSessionOwnership.owns(generation) ? "disconnect_completed" : "disconnect_superseded",
        generation,
      );
    }
  };

  const ensureLocalStream = async (
    preferredInputDeviceId?: string,
    { reuseExisting = false }: { reuseExisting?: boolean } = {},
  ) => {
    if (reuseExisting) {
      const existingStream =
        activeProcessedMicrophone?.stream ?? useRoomStore.getState().localStream;
      const hasLiveAudio = existingStream
        ?.getAudioTracks()
        .some((track) => track.readyState === "live");
      if (existingStream && hasLiveAudio) {
        return existingStream;
      }
    }

    const currentSettings = useSettingsStore.getState().settings;
    const previousProcessor = activeProcessedMicrophone;
    activeProcessedMicrophone = null;
    try {
      previousProcessor?.dispose();
    } catch (cleanupError) {
      void writeRendererLog("audio", "warn", "Previous microphone cleanup failed", {
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }

    let acquiredSource: Awaited<ReturnType<typeof acquireAudioSource>> | undefined;
    let processedMicrophone: ProcessedMicrophoneStream | undefined;
    try {
      const selectedDeviceId =
        preferredInputDeviceId ??
        (activeInputSourceId === PHONE_MIC_DEVICE_ID
          ? activeInputSourceId
          : currentSettings?.preferredInputDeviceId);
      acquiredSource = await acquireAudioSource(selectedDeviceId, {
        echoCancellation: currentSettings?.isEchoCancellationEnabled ?? true,
        autoGainControl: currentSettings?.isAutoGainControlEnabled ?? true,
      });
      const { stream: inputStream, diagnostics, stopInputOnDispose } = acquiredSource;
      processedMicrophone = await createProcessedMicrophoneStream(inputStream, {
        micEqualizerGains: currentSettings?.micEqualizerGains ?? [0, 0, 0, 0, 0],
        lowCutFrequency: currentSettings?.lowCutFrequency ?? "75",
        isNoiseSuppressionEnabled: currentSettings?.isNoiseSuppressionEnabled ?? true,
        isVoiceEnhancementEnabled: currentSettings?.isVoiceEnhancementEnabled ?? true,
        microphoneSendVolume: currentSettings?.microphoneSendVolume ?? 1,
        getRemoteReferenceLevel: () => getRemoteAudioMixer().getRemoteReferenceLevel(),
        stopInputOnDispose,
      });
      activeProcessedMicrophone = processedMicrophone;
      activeInputSourceId = selectedDeviceId;
      const stream = processedMicrophone.stream;

      setLocalStream(stream);
      setLocalDiagnostics({ ...diagnostics, ...processedMicrophone.processorDiagnostics });
      processedMicrophone.onDiagnostics((processorDiagnostics) => {
        if (activeProcessedMicrophone !== processedMicrophone) return;
        setLocalDiagnostics({ ...diagnostics, ...processorDiagnostics });
      });
      void processedMicrophone.ready.then((processorDiagnostics) => {
        if (activeProcessedMicrophone !== processedMicrophone) return;
        setLocalDiagnostics({ ...diagnostics, ...processorDiagnostics });
      });
      await writeRendererLog("audio", "info", "Acquired local microphone stream", {
        ...diagnostics,
      });
      if (diagnostics.sampleRateFallbackApplied) {
        pushToast({
          tone: "neutral",
          title: "已自动兼容麦克风",
          description: "设备不支持所选采样率，已回退到设备原生采样率。",
        });
      }
      return stream;
    } catch (error) {
      if (processedMicrophone) {
        processedMicrophone.dispose();
        if (activeProcessedMicrophone === processedMicrophone) {
          activeProcessedMicrophone = null;
          setLocalStream(undefined);
          activeInputSourceId = undefined;
        }
      } else if (acquiredSource) {
        releaseAcquiredAudioSource(acquiredSource);
      }
      await writeRendererLog("audio", "error", "Failed to acquire local microphone stream", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(normalizeRoomError(error, copy.microphoneUnavailable), {
        cause: error,
      });
    }
  };

  const connectToRoom = async (
    serverUrl: string,
    channelId: ChannelId,
    { reuseLocalMedia = false }: { reuseLocalMedia?: boolean } = {},
  ) => {
    const generation = roomSessionOwnership.current();
    const currentSettings = useSettingsStore.getState().settings;
    roomSessionOwnership.record("microphone_acquire_started", generation);
    const stream = await ensureLocalStream(undefined, { reuseExisting: reuseLocalMedia });
    roomSessionOwnership.record("microphone_acquired", generation);
    const peerId = crypto.randomUUID();
    activePeerId = peerId;
    const isCurrentSession = () => roomSessionOwnership.ownsPeer(generation, peerId, activePeerId);
    const localProfileId = currentSettings?.profileId || crypto.randomUUID();
    if (currentSettings && !currentSettings.profileId) {
      await useSettingsStore.getState().saveSettings({ profileId: localProfileId });
    }
    const accountSnapshot = useAccountStore.getState().snapshot;
    // Signed-in identity is derived from the verified access token. Omitting the
    // provider-specific id keeps current clients compatible with older relays
    // that only accepted UUID-shaped profile ids. Guests still send the stable
    // local profile id because they have no authenticated server identity.
    const signalingProfileId = accountSnapshot.status === "signed_in" ? undefined : localProfileId;
    const roomName = useRoomStore.getState().room.roomName;
    const memberPresence = new MemberPresenceTracker();

    activeClient = new RoomClient({
      signalingUrl: serverUrl,
      roomId: channelId,
      peerId,
      profileId: signalingProfileId,
      nickname: accountSnapshot.profile?.displayName || currentSettings?.nickname || "访客",
      avatarDataUrl: undefined,
      avatarId: randomRoomAvatar(currentSettings?.avatarId),
      localStream: stream,
      appVersion: runtimeInfo?.version ?? "0.0.0",
      protocolVersion: runtimeInfo?.protocolVersion ?? APP_PROTOCOL_VERSION,
      buildNumber: runtimeInfo?.buildNumber ?? APP_BUILD_NUMBER,
      onMembers: (members) => {
        if (!isCurrentSession()) return;
        const { joined, left } = memberPresence.collect(members);
        const previousMembers = useRoomStore.getState().room.members;
        const savedVolumes = useSettingsStore.getState().settings?.memberVolumes ?? {};
        const audioState = useAudioStore.getState();
        const membersWithVolume = projectRoomMembers(members, {
          savedVolumes,
          audioState,
          profile: useAccountStore.getState().snapshot.profile,
          settings: useSettingsStore.getState().settings,
          runtimeMemberVolumes,
          saveLegacyVolume: scheduleMemberVolumeSave,
        });
        for (const member of membersWithVolume) {
          if (!member.isLocal) activeClient?.setPeerVolume(member.id, member.volume);
        }
        setMembers(membersWithVolume);

        joined.forEach((member) => {
          pushRoomEvent({
            level: "success",
            memberName: member.nickname,
            message: `${member.nickname} 加入频道`,
          });
          if (
            !member.isLocal &&
            useSettingsStore.getState().settings?.isSystemNotificationEnabled !== false
          ) {
            sendSystemNotification({
              title: "好友上线",
              body: `${member.nickname} 进入了开黑频道`,
            });
          }
        });

        left.forEach((memberId) => {
          const leftMember = previousMembers.find((member) => member.id === memberId);
          pushRoomEvent({
            level: "warning",
            memberName: leftMember?.nickname,
            message: `${leftMember?.nickname ?? "有成员"} 离开频道`,
          });
        });
      },
      onRoomName: (nextRoomName, privateRoom) => {
        if (isCurrentSession()) setRoom({ roomName: nextRoomName, privateRoom });
      },
      onConnectionState: (state) => {
        if (!isCurrentSession()) return;
        setConnectionState(state);
        if (state === RoomConnectionState.WaitingSnapshot) {
          pushRoomEvent({ level: "info", message: "已连接，正在同步成员…" });
        }
        if (state === RoomConnectionState.WaitingPeer) {
          pushRoomEvent({ level: "info", message: "等待好友加入" });
        }
      },
      onReconnectAttempt: (attempt) => {
        if (!isCurrentSession()) return;
        roomSessionOwnership.record("reconnect_attempt", generation);
        setConnectionHealth({ reconnectAttempt: attempt, lastUpdatedAt: new Date().toISOString() });
        pushRoomEvent({ level: "warning", message: `连接有波动，正在第 ${attempt} 次重连…` });
      },
      onReconnectExhausted: (error) => {
        if (!isCurrentSession()) return;
        roomSessionOwnership.record("reconnect_exhausted", generation);
        const protocolRejected = error.message === "signaling_protocol_rejected";
        void writeRendererLog("signaling", "error", "Signaling reconnect exhausted", {
          roomId: channelId,
          peerId,
          error: error.message,
        });
        void (async () => {
          if (!isCurrentSession()) return;
          await cleanupPreviousSession({ resetStore: true });
          if (!roomSessionOwnership.owns(generation)) return;
          setConnectionState(RoomConnectionState.Failed, "连接已断开，请重新进入频道。");
          setLifecycleState(RoomLifecycleState.Failed);
          pushToast({
            tone: "danger",
            title: protocolRejected ? "连接数据被服务器拒绝" : "连接已断开",
            description: protocolRejected
              ? "客户端与服务器的数据格式不一致，已停止反复重连。请导出诊断包后再试。"
              : isPrivateRoomId(channelId)
                ? privateRoomErrorMessage(error)
                : "自动重连未成功，音频已经安全停止，请重新进入频道。",
          });
          useAppStore.getState().navigate("home");
        })();
      },
      onUpdateRequired: (requiredVersion, currentVersion) => {
        if (!isCurrentSession()) return;
        useAppStore.getState().requireUpdate(requiredVersion, currentVersion);
      },
      onAvatarConflict: (availableAvatarIds) => {
        if (!isCurrentSession()) return;
        const localMember = useRoomStore
          .getState()
          .room.members.find((member) => member.isLocal && !member.isEmptySlot);
        if (localMember?.avatarId) {
          void useSettingsStore.getState().saveSettings({ avatarId: localMember.avatarId });
        }
        pushToast({
          tone: "warning",
          title: "角色已被朋友选择",
          description:
            availableAvatarIds.length > 0
              ? "已保留你原来的角色；下次更换时请选择未占用的角色。"
              : "频道里的角色都已被占用。",
        });
      },
      onSnapshotRevision: (revision) => {
        if (!isCurrentSession()) return;
        setConnectionHealth({ lastUpdatedAt: new Date().toISOString() });
        void writeRendererLog("signaling", "info", "Applied fixed channel snapshot", {
          roomId: channelId,
          peerId,
          revision,
        });
      },
      onRtt: (latencyMs) => {
        if (!isCurrentSession()) return;
        setConnectionHealth({ latencyMs, lastUpdatedAt: new Date().toISOString() });
        updatePeerLatency(peerId, latencyMs);
      },
      onPeerLatency: (remotePeerId, latencyMs) => {
        if (isCurrentSession()) updatePeerLatency(remotePeerId, latencyMs);
      },
      onPeerStats: (statsByPeer) => {
        if (!isCurrentSession()) return;
        const snapshots = Object.values(statsByPeer);
        const jitterMs = snapshots.reduce(
          (highest, snapshot) => Math.max(highest, snapshot.jitterMs ?? 0),
          0,
        );
        const packetLossPercent = snapshots.reduce(
          (highest, snapshot) => Math.max(highest, snapshot.packetLossPercent ?? 0),
          0,
        );
        const availableOutgoingBitrateKbps = snapshots.reduce<number | undefined>(
          (lowest, snapshot) => {
            const bitrate = snapshot.availableOutgoingBitrateBps;
            if (typeof bitrate !== "number" || bitrate <= 0) return lowest;
            const kbps = Math.round(bitrate / 1_000);
            return lowest === undefined ? kbps : Math.min(lowest, kbps);
          },
          undefined,
        );
        const usesTurn = snapshots.some((snapshot) => snapshot.connectionType === "relay");
        setConnectionHealth({
          jitterMs,
          packetLossPercent,
          availableOutgoingBitrateKbps,
          voicePath:
            snapshots.length === 0 ? "unknown" : usesTurn ? "webrtc_turn" : "webrtc_direct",
          turnConfigured: getRoomRuntimeDiagnostics()?.turnConfigured ?? false,
          relayFallbackActive: false,
          lastUpdatedAt: new Date().toISOString(),
        });
      },
      onRemoteStream: (remotePeerId, remoteStream) => {
        if (isCurrentSession()) setRemoteStream(remotePeerId, remoteStream);
      },
      onRemoteScreenFrame: (remotePeerId, frame) => {
        if (isCurrentSession()) setRemoteScreenFrame(remotePeerId, frame);
      },
      onRemoteScreenShareState: (remotePeerId, sharing) => {
        if (isCurrentSession()) setRemoteScreenSharing(remotePeerId, sharing);
      },
      onLocalScreenShareViewers: (viewerPeerIds) => {
        if (isCurrentSession()) setLocalScreenShareViewerPeerIds(viewerPeerIds);
      },
      onSceneReaction: (reaction) => {
        if (!isCurrentSession()) return;
        addSceneReaction(reaction);
        if (reaction.targetPeerId === peerId && reaction.peerId !== peerId) {
          playSceneReactionSound("receive-message");
        }
      },
      onQuickMessage: (message) => {
        if (!isCurrentSession() || activeLeavePromise) return;
        addQuickMessage(message);
        const currentSettings = useSettingsStore.getState().settings;
        if (
          !message.isLocal &&
          currentSettings?.quickMessages.soundEnabled !== false &&
          currentSettings?.quickMessages
        ) {
          playQuickMessageSound(
            message.soundId,
            message.avatarId,
            currentSettings.quickMessages.soundVolume,
            message.content,
            message.mediaType,
            {
              peerId: message.peerId,
              nickname: message.nickname,
              messageId: message.id,
              presetId: message.presetId,
            },
          );
        }
        if (!message.isLocal && currentSettings?.isSystemNotificationEnabled !== false) {
          sendSystemNotification({
            title: `${message.nickname} 提醒你`,
            body: message.content,
          });
        }
      },
      onQuickMessageControl: ({ presetId }) => {
        if (!isCurrentSession()) return;
        const preset = findQuickMessagePreset(presetId);
        if (preset?.mediaType === "music") {
          toggleQuickMessageMusic(preset.soundId);
        }
      },
      onChatMessage: (message) => {
        if (!isCurrentSession()) return;
        addChatMessage(message);
        persistChatHistory(serverUrl, channelId);
        if (!message.isLocal) {
          playUiSound("receive-message");
          if (useSettingsStore.getState().settings?.isSystemNotificationEnabled !== false) {
            sendSystemNotification({
              title: `${message.nickname} 发来消息`,
              body: describeChatNotification(message),
            });
          }
        }
      },
      onChatRecall: ({ messageId }) => {
        if (!isCurrentSession()) return;
        removeChatMessage(messageId);
        persistChatHistory(serverUrl, channelId);
      },
      onChatHistory: (messages) => {
        if (!isCurrentSession()) return;
        mergeChatHistory(messages);
        persistChatHistory(serverUrl, channelId);
      },
      onDailyRoomReports: (targetRoomId, reports) => {
        if (isCurrentSession())
          useDailyRoomReportStore.getState().setReports(targetRoomId, reports);
      },
      onRoomCollection: (items, replace) => {
        if (!isCurrentSession()) return;
        if (replace) setCollectionItems(items);
        else mergeCollectionItems(items);
      },
      onKnock: (message) => {
        if (!isCurrentSession()) return;
        addChatMessage(message);
        persistChatHistory(serverUrl, channelId);
        playUiSound("knock-bell");
        window.setTimeout(() => {
          if (isCurrentSession()) playUiSound("knock-bell");
        }, 190);
        if (!message.isLocal) {
          pushToast({
            tone: "warning",
            title: `${message.nickname} 敲了敲你`,
            description: "快来上号，朋友正在等你。",
          });
          sendSystemNotification({
            title: `${message.nickname} 敲了敲你`,
            body: "快来上号，朋友正在等你。",
            attention: true,
            shakeWindow: true,
            showNotification:
              useSettingsStore.getState().settings?.isSystemNotificationEnabled !== false,
          });
        }
      },
      onDiagnosticEvent: (payload) => {
        if (!isCurrentSession()) return;
        const summary = summarizeSignalingEvent(payload);
        if (
          payload.type === "message" &&
          typeof summary.messageType === "string" &&
          ROUTINE_SIGNAL_MESSAGE_TYPES.has(summary.messageType)
        ) {
          return;
        }
        const isError = payload.type === "error" || summary.messageType === "error";
        void writeRendererLog(
          "signaling",
          isError ? "warn" : "info",
          "Signaling bridge event",
          summary,
        );
      },
    });

    setRoom({
      roomId: channelId,
      roomName,
      lifecycleState: RoomLifecycleState.Opening,
      signalingUrl: serverUrl,
      latestFailureReason: undefined,
    });

    roomSessionOwnership.record("connect_started", generation);
    await activeClient.connect();
    roomSessionOwnership.record("connected", generation);
    useDailyRoomReportStore.getState().beginLoading([channelId]);
    const reportClient = activeClient;
    void Promise.allSettled([reportClient.requestDailyRoomReports(channelId)]).then(
      (reportRequests) => {
        if (activeClient !== reportClient) return;
        const unavailableRooms = [channelId].filter((_, index) => {
          const result = reportRequests[index];
          return result?.status === "rejected" || result?.value === false;
        });
        if (unavailableRooms.length) {
          useDailyRoomReportStore.getState().setUnavailable([...unavailableRooms]);
        }
      },
    );
    const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
    activeClient.updateMuteState(useAudioStore.getState().isMuted, false);
    activeClient.updatePresenceState(
      useAudioStore.getState().isDeafened,
      localMember?.activity ?? "idle",
      localMember?.sceneZone,
      localMember?.gameName,
      localMember?.musicActivity,
      localMember?.gameIconDataUrl,
      useAudioStore.getState().phoneModeActive,
    );
    playUiSound("enter-room");
    setRoom({
      roomId: channelId,
      roomName,
      lifecycleState: RoomLifecycleState.Open,
      signalingUrl: serverUrl,
      latestFailureReason: undefined,
    });
    if (!reuseLocalMedia) {
      startSpeakingDetector(stream);
    }
  };

  const joinChannel = (
    serverUrlOverride: string | undefined,
    requestedChannelId: ChannelId,
  ): Promise<void> => {
    // A fast rejoin waits for the preceding leave to release its own client and
    // media before the next room begins acquiring them.
    if (activeLeavePromise) {
      return activeLeavePromise.then(() => joinChannel(serverUrlOverride, requestedChannelId));
    }
    if (activeJoinPromise) {
      void writeRendererLog("signaling", "info", "Ignored duplicate fixed channel join request");
      return activeJoinPromise;
    }
    const joinPromise = (async () => {
      const currentSettings = useSettingsStore.getState().settings;
      if (!currentSettings) return;
      const joiningUserId = useAccountStore.getState().snapshot.profile?.userId;
      if (useAppStore.getState().requiredUpdate) {
        useAppStore.getState().enterUpdateGate();
        return;
      }
      if (!isStoredRoomId(requestedChannelId)) throw new Error("room_not_found");
      const channelId = requestedChannelId;

      let serverUrl: string;
      try {
        serverUrl = normalizeServerUrl(serverUrlOverride || currentSettings.relayServerUrl);
      } catch (error) {
        const description = normalizeRoomError(error, copy.joinTitle);
        pushToast({ tone: "warning", title: copy.joinTitle, description });
        return;
      }

      const generation = roomSessionOwnership.advance();
      roomSessionOwnership.record("join_requested", generation);

      setRoomAction("joining");
      setConnectionState(RoomConnectionState.Joining);
      clearRoomEvents();
      pushRoomEvent({
        level: "info",
        message: "正在进入房间",
      });
      try {
        const reuseLocalMedia = false;
        await cleanupPreviousSession({ preserveLocalMedia: reuseLocalMedia });
        clearChannelContent();
        setRoom({
          roomId: channelId,
          roomName: "私人房间",
          privateRoom: undefined,
          lifecycleState: RoomLifecycleState.Opening,
          signalingUrl: serverUrl,
        });
        if (isPrivateRoomId(channelId)) {
          const metadata = await shanghaoCore.rooms.get(channelId);
          if (metadata.onlineCount >= metadata.capacity) throw new Error("room_full");
          setRoom({ privateRoom: metadata, roomName: metadata.name });
        }
        const readChatHistory = window.desktopApi?.app?.readChatHistory;
        const chatHistoryPromise =
          typeof readChatHistory === "function"
            ? readChatHistory({ serverUrl, channelId }).catch((error) => {
                void writeRendererLog("app", "warn", "Failed to restore local chat history", {
                  channelId,
                  error: error instanceof Error ? error.message : String(error),
                });
                return [];
              })
            : Promise.resolve([]);
        void writeRendererLog("signaling", "info", "Joining fixed channel", {
          serverUrl,
          channelId,
        });
        await connectToRoom(serverUrl, channelId, { reuseLocalMedia });
        const joinedRoom = useRoomStore.getState().room.privateRoom;
        if (joinedRoom && joiningUserId === useAccountStore.getState().snapshot.profile?.userId)
          rememberRoomDirectory(joiningUserId, serverUrl, joinedRoom);
        // Keep the entry page visible until microphone acquisition, authorization,
        // join acknowledgement and the first room snapshot have all succeeded.
        // A failed device check must never flash the room shell before returning.
        useAppStore.getState().navigate("room");
        if (isPrivateRoomId(channelId))
          void shanghaoCore.rooms.rememberJoined(channelId).catch(() => {
            pushToast({
              tone: "warning",
              title: "房间已进入，最近记录未保存",
              description: "本地记录无法写入，可在诊断中检查存储权限。",
            });
          });
        const cachedMessages = await chatHistoryPromise;
        mergeChatHistory(cachedMessages);
      } catch (error) {
        roomSessionOwnership.record("join_failed", generation);
        if (error instanceof Error && error.message === "CLIENT_UPDATE_REQUIRED") {
          await cleanupPreviousSession();
          return;
        }
        const description = isPrivateRoomId(channelId)
          ? privateRoomErrorMessage(error)
          : normalizeRoomError(error, copy.networkFailed);
        await writeRendererLog("signaling", "error", "Failed to join fixed channel", {
          serverUrl,
          channelId,
          error: error instanceof Error ? error.message : String(error),
          ...activeClient?.getDiagnostics(),
        });
        await cleanupPreviousSession();
        useAppStore.getState().navigate("home");
        setConnectionState(RoomConnectionState.Failed, description);
        setRoom({
          lifecycleState: RoomLifecycleState.Failed,
          signalingUrl: serverUrl,
        });
        pushRoomEvent({ level: "error", message: description });
        pushToast({ tone: "danger", title: copy.joinTitle, description });
      } finally {
        setRoomAction("idle");
      }
    })();

    activeJoinPromise = joinPromise;
    void joinPromise.then(
      () => {
        if (activeJoinPromise === joinPromise) activeJoinPromise = null;
      },
      () => {
        if (activeJoinPromise === joinPromise) activeJoinPromise = null;
      },
    );
    return joinPromise;
  };

  const switchChannel = (channelId: ChannelId): Promise<void> => {
    if (channelId === room.roomId && activeClient) return Promise.resolve();
    return joinChannel(
      room.signalingUrl || useSettingsStore.getState().settings?.relayServerUrl,
      channelId,
    );
  };

  const replaceInputDevice = (preferredInputDeviceId?: string) => {
    const client = activeClient;
    const generation = roomSessionOwnership.current();
    const ownsSwitch = () => activeClient === client && roomSessionOwnership.owns(generation);
    const operation = inputDeviceSwitchQueue.then(async () => {
      const currentSettings = useSettingsStore.getState().settings;
      if (!client || !ownsSwitch() || !currentSettings) {
        return false;
      }
      roomSessionOwnership.record("device_switch_started", generation);

      let pendingSource: Awaited<ReturnType<typeof acquireAudioSource>> | undefined;
      let pendingProcessor: ProcessedMicrophoneStream | undefined;
      try {
        const acquiredSource = await acquireAudioSource(
          preferredInputDeviceId ?? currentSettings.preferredInputDeviceId,
          {
            echoCancellation: currentSettings.isEchoCancellationEnabled,
            autoGainControl: currentSettings.isAutoGainControlEnabled,
          },
        );
        pendingSource = acquiredSource;
        if (!ownsSwitch()) {
          roomSessionOwnership.record("device_switch_discarded", generation);
          return false;
        }
        const { stream: inputStream, diagnostics, stopInputOnDispose } = acquiredSource;
        const processedMicrophone = await createProcessedMicrophoneStream(inputStream, {
          ...currentSettings,
          stopInputOnDispose,
        });
        pendingProcessor = processedMicrophone;
        const stream = processedMicrophone.stream;
        const [nextTrack] = stream.getAudioTracks();
        if (!nextTrack) {
          throw new Error(copy.microphoneMissing);
        }

        if (!ownsSwitch()) {
          roomSessionOwnership.record("device_switch_discarded", generation);
          return false;
        }
        await client.replaceInputTrack(nextTrack);
        if (!ownsSwitch()) {
          roomSessionOwnership.record("device_switch_discarded", generation);
          return false;
        }
        const previousProcessor = activeProcessedMicrophone;
        activeProcessedMicrophone = processedMicrophone;
        activeInputSourceId = preferredInputDeviceId;
        pendingSource = undefined;
        pendingProcessor = undefined;
        try {
          previousProcessor?.dispose();
        } catch (cleanupError) {
          void writeRendererLog("audio", "warn", "Previous microphone cleanup failed", {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
        setLocalDiagnostics({ ...diagnostics, ...processedMicrophone.processorDiagnostics });
        processedMicrophone.onDiagnostics((processorDiagnostics) => {
          if (activeProcessedMicrophone !== processedMicrophone) return;
          setLocalDiagnostics({ ...diagnostics, ...processorDiagnostics });
        });
        void processedMicrophone.ready.then((processorDiagnostics) => {
          if (activeProcessedMicrophone !== processedMicrophone) return;
          setLocalDiagnostics({ ...diagnostics, ...processorDiagnostics });
        });
        setLocalStream(stream);
        try {
          startSpeakingDetector(stream);
        } catch (detectorError) {
          void writeRendererLog(
            "audio",
            "warn",
            "Speaking detector unavailable after input switch",
            {
              error: detectorError instanceof Error ? detectorError.message : String(detectorError),
            },
          );
          pushToast({
            tone: "warning",
            title: "麦克风已切换",
            description: "说话状态检测暂不可用，请重新进入房间。",
          });
        }
        await writeRendererLog("devices", "info", "Switched input device", {
          preferredInputDeviceId,
          ...diagnostics,
        });
        roomSessionOwnership.record("device_switch_applied", generation);
        return true;
      } catch (error) {
        if (!ownsSwitch()) {
          roomSessionOwnership.record("device_switch_discarded", generation);
          return false;
        }
        roomSessionOwnership.record("device_switch_failed", generation);
        const description = normalizeRoomError(error, copy.microphoneUnavailable);
        await writeRendererLog("devices", "error", "Failed to switch input device", {
          preferredInputDeviceId,
          error: error instanceof Error ? error.message : String(error),
        });
        pushToast({
          tone: "danger",
          title: copy.inputDeviceFailed,
          description,
        });
        playUiSound("mic-error");
        return false;
      } finally {
        if (pendingProcessor) pendingProcessor.dispose();
        else if (pendingSource) releaseAcquiredAudioSource(pendingSource);
      }
    });
    inputDeviceSwitchQueue = operation.catch(() => undefined);
    return operation;
  };

  const setMicrophoneSendVolume = (volume: number) => {
    activeProcessedMicrophone?.setSendVolume(volume);
  };

  const leaveRoom = () => {
    stopQuickMessageMusic();
    if (activeLeavePromise) return activeLeavePromise;
    roomSessionOwnership.record("leave_requested");
    const pendingJoin = activeJoinPromise;
    activeLeavePromise = (async () => {
      try {
        if (pendingJoin) await pendingJoin.catch(() => undefined);
        roomSessionOwnership.advance();
        playUiSound("leave-room");
        setLifecycleState(RoomLifecycleState.Closing);
        const settings = useSettingsStore.getState().settings;
        if (settings) {
          useRoomStore.getState().syncLocalProfile({
            nickname: settings.nickname,
            avatarPath: settings.avatarPath,
            avatarDataUrl,
            avatarId: settings.avatarId,
          });
        }
        await cleanupPreviousSession({ resetStore: true });
        useAppStore.getState().navigate("home");
        roomSessionOwnership.record("leave_completed");
      } catch (error) {
        await writeRendererLog("signaling", "error", "Failed to leave room cleanly", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        activeLeavePromise = undefined;
      }
    })();
    return activeLeavePromise;
  };

  const copyInviteLink = async () => {
    try {
      if (!room.privateRoom) throw new Error("room_not_found");
      const inviteText = buildChannelInviteText({
        channelId: room.roomId,
        channelCode: room.privateRoom.channelCode,
        roomName: room.privateRoom.name,
        serverUrl: useSettingsStore.getState().settings?.relayServerUrl,
      });
      await window.desktopApi.clipboard.writeText(inviteText);
      playUiSound("copy-success");
      await writeRendererLog("app", "info", "Copied room invite", {
        channelId: room.roomId,
      });
      pushToast({
        tone: "success",
        title: "邀请链接已复制",
        description: copy.copiedInviteDescription,
      });
    } catch {
      pushToast({
        tone: "warning",
        title: "复制失败",
        description: "请手动复制当前地址。",
      });
    }
  };

  const sendChatMessage = async (
    content: string,
    image?: ChatImageAttachment,
    existingClientMessageId?: string,
  ) => {
    const trimmed = content.trim();
    const settings = useSettingsStore.getState().settings;
    if ((!trimmed && !image) || !settings) return;

    if (!activeClient) {
      pushToast({
        tone: "warning",
        title: "还没进入频道",
        description: "进入频道后就能和朋友轻轻说一句。",
      });
      return;
    }

    if (!activeClient.canSendChat()) {
      pushToast({
        tone: "warning",
        title: "正在重连",
        description: "连接恢复后再发送消息。",
      });
      throw new Error("signaling_not_connected");
    }

    const clientMessageId = existingClientMessageId ?? crypto.randomUUID();
    const localPeer = useRoomStore.getState().room.members.find((member) => member.isLocal);
    const existing = useRoomStore
      .getState()
      .chatMessages.find((message) => message.clientMessageId === clientMessageId);
    if (!existing) {
      addChatMessage({
        id: `local:${clientMessageId}`,
        clientMessageId,
        peerId: localPeer?.id ?? "local-member",
        nickname: localPeer?.nickname ?? settings.nickname,
        avatarUrl: localPeer?.avatarUrl,
        avatarDataUrl: localPeer?.avatarDataUrl,
        avatarId: localPeer?.avatarId,
        content: trimmed,
        image,
        createdAt: new Date().toISOString(),
        isLocal: true,
        kind: "chat",
        deliveryState: "sending",
        retryCount: 0,
      });
    } else {
      updateChatDelivery(clientMessageId, {
        deliveryState: "sending",
        failureReason: undefined,
        retryCount: (existing.retryCount ?? 0) + 1,
      });
    }

    try {
      const ack = await activeClient.sendChatMessage(trimmed, image, clientMessageId);
      updateChatDelivery(clientMessageId, {
        id: ack.messageId,
        createdAt: ack.acceptedAt,
        deliveryState: "sent",
        failureReason: undefined,
      });
      const activeRoom = useRoomStore.getState().room;
      const historyServerUrl = activeRoom.signalingUrl ?? settings.relayServerUrl;
      if (historyServerUrl) {
        persistChatHistory(historyServerUrl, activeRoom.roomId);
      }
    } catch (error) {
      updateChatDelivery(clientMessageId, {
        deliveryState: "failed",
        failureReason: error instanceof Error ? error.message : "chat_send_failed",
      });
      await writeRendererLog("signaling", "warn", "Chat message send failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      pushToast({
        tone: "danger",
        title: "消息发送失败",
        description: "消息已保留，点击消息旁的“重新发送”即可重试。",
      });
      throw error;
    }
  };

  const sendKnock = async () => {
    if (!activeClient || !activeClient.canSendChat()) {
      pushToast({
        tone: "warning",
        title: "还没进入频道",
        description: "进入频道后才能敲一敲大家。",
      });
      return;
    }

    await activeClient.sendKnock();
  };

  const recallChatMessage = async (messageId: string) => {
    if (!activeClient?.canSendChat()) {
      throw new Error("signaling_not_connected");
    }
    await activeClient.recallChatMessage(messageId);
  };

  const sendSceneReaction = async (
    targetPeerId: string,
    emoji: import("@private-voice/shared").SceneReaction["emoji"],
  ) => {
    if (!activeClient?.canSendChat()) {
      return;
    }
    await activeClient.sendSceneReaction(targetPeerId, emoji);
    playSceneReactionSound("send-message");
  };

  const sendConfiguredQuickMessage = async (presetId: string) => {
    const preset = findQuickMessagePreset(presetId);
    const targetPeerId = preset ? encodeQuickMessageTarget(preset.id) : undefined;
    if (!preset || !targetPeerId || !activeClient?.canSendChat()) {
      throw new Error("signaling_not_connected");
    }
    if (preset.mediaType === "music" && toggleQuickMessageMusic(preset.soundId)) {
      await activeClient.sendSceneReaction(encodeQuickMessageControlTarget(preset.id), "👍");
      return;
    }
    const now = Date.now();
    if (now - lastQuickMessageSentAt < lastQuickMessageCooldownMs) return;
    lastQuickMessageSentAt = now;
    lastQuickMessageCooldownMs = quickMessageCooldownMs(preset);

    const currentSettings = useSettingsStore.getState().settings;
    if (currentSettings?.quickMessages.soundEnabled !== false && currentSettings?.quickMessages) {
      const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
      playQuickMessageSound(
        preset.soundId,
        currentSettings.avatarId,
        currentSettings.quickMessages.soundVolume,
        preset.content,
        preset.mediaType,
        {
          peerId: activePeerId ?? localMember?.id,
          nickname: currentSettings.nickname ?? localMember?.nickname,
          messageId: `quick-${activePeerId ?? localMember?.id ?? "local"}-${now}`,
          presetId: preset.id,
        },
      );
    }
    await activeClient.sendSceneReaction(targetPeerId, "👍");
  };

  const stopSharedQuickMessageMusic = async (source: {
    peerId: string;
    messageId: string;
  }): Promise<boolean> => {
    const audio = getQuickMessageAudioSnapshot();
    if (
      !activeClient?.canSendChat() ||
      source.peerId !== activePeerId ||
      audio.status !== "playing" ||
      audio.mediaType !== "music" ||
      audio.sourcePeerId !== source.peerId ||
      audio.quickMessageId !== source.messageId ||
      !audio.presetId
    ) {
      return false;
    }
    if (!stopQuickMessageMusic(audio.soundId)) return false;
    await activeClient.sendSceneReaction(encodeQuickMessageControlTarget(audio.presetId), "👍");
    return true;
  };

  const sendQuickMessage = async (content: string) => {
    const preset = presetForQuickReplyContent(content);
    if (preset) {
      await sendConfiguredQuickMessage(preset.id);
      return;
    }
    const targetPeerId = encodeQuickReplyTarget(content);
    if (!targetPeerId || !activeClient?.canSendChat()) {
      throw new Error("signaling_not_connected");
    }
    const now = Date.now();
    if (now - lastQuickMessageSentAt < QUICK_REPLY_COOLDOWN_MS) return;
    lastQuickMessageSentAt = now;
    lastQuickMessageCooldownMs = QUICK_REPLY_COOLDOWN_MS;
    await activeClient.sendSceneReaction(targetPeerId, "👍");
  };

  const quickMessageShortcutHandlerRef = useRef<QuickMessageShortcutHandler>(() => undefined);
  quickMessageShortcutHandlerRef.current = (slotIndex) => {
    const currentSettings = useSettingsStore.getState().settings;
    if (!currentSettings) return;
    const slot = getQuickMessageShortcutSlots(currentSettings.quickMessages)[slotIndex];
    if (!slot?.enabled || !slot.presetId) return;
    void sendConfiguredQuickMessage(slot.presetId).catch(() => {
      pushToast({
        tone: "warning",
        title: "快捷消息没有发出去",
        description: "进入房间后才能使用快捷键发送。",
      });
    });
  };

  useEffect(() => {
    const handler: QuickMessageShortcutHandler = (slotIndex) => {
      quickMessageShortcutHandlerRef.current(slotIndex);
    };
    activeQuickMessageShortcutHandler = handler;
    return () => {
      if (activeQuickMessageShortcutHandler === handler) {
        activeQuickMessageShortcutHandler = undefined;
      }
    };
  }, []);

  useEffect(
    () =>
      window.desktopApi.overlay.onQuickMessageMute(({ peerId, messageId }) => {
        if (peerId === activePeerId) {
          void stopSharedQuickMessageMusic({ peerId, messageId });
          return;
        }
        muteQuickMessagePlayback({ peerId, messageId });
      }),
    [],
  );

  const startScreenShare = async (stream: MediaStream, profile?: ScreenShareEncodingProfile) => {
    if (!activeClient) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("room_not_connected");
    }

    await activeClient.startScreenShare(stream, profile);
    await writeRendererLog("webrtc", "info", "Screen share started from room state", {
      videoTracks: stream.getVideoTracks().length,
    });
  };

  const stopScreenShare = async () => {
    await activeClient?.stopScreenShare();
    await writeRendererLog("webrtc", "info", "Screen share stopped from room state");
  };

  const setScreenShareViewingActive = useCallback((active: boolean) => {
    activeClient?.setScreenShareViewingActive(active);
  }, []);

  const moveLocalMember = (
    sceneZone: SceneZoneId,
    activity: MemberActivity,
    gameName?: string,
    musicActivity?: RoomMember["musicActivity"],
    gameIconDataUrl?: string,
  ) => {
    const currentLocalMember = useRoomStore
      .getState()
      .room.members.find((member) => member.isLocal);
    const sameMusicActivity =
      currentLocalMember?.musicActivity?.provider === musicActivity?.provider &&
      currentLocalMember?.musicActivity?.providerName === musicActivity?.providerName &&
      currentLocalMember?.musicActivity?.trackTitle === musicActivity?.trackTitle &&
      currentLocalMember?.musicActivity?.artist === musicActivity?.artist;
    if (
      currentLocalMember &&
      currentLocalMember.sceneZone === sceneZone &&
      currentLocalMember.activity === activity &&
      currentLocalMember.gameName === gameName &&
      currentLocalMember.gameIconDataUrl === gameIconDataUrl &&
      sameMusicActivity
    ) {
      return;
    }
    if (sceneZone === "restroomZone") {
      useAudioStore.getState().setMuted(true);
      activeClient?.updateMuteState(true, false);
    }
    updateLocalPresence({
      sceneZone,
      activity,
      gameName,
      gameIconDataUrl,
      musicActivity,
    });
    activeClient?.updatePresenceState(
      isDeafened,
      activity,
      sceneZone,
      gameName,
      musicActivity,
      gameIconDataUrl,
    );
    void writeRendererLog("app", "info", "Local member moved in scene", {
      sceneZone,
      activity,
      gameName,
      musicProvider: musicActivity?.provider,
    });
  };

  const setMemberVolume = (memberId: string, volume: number) => {
    const normalizedVolume = clampMemberVolume(volume);
    const member = useRoomStore
      .getState()
      .room.members.find((candidate) => candidate.id === memberId);
    if (!member || member.isLocal || member.isEmptySlot) return;
    const storageKey = member.profileId || member.nickname;
    runtimeMemberVolumes.set(storageKey, normalizedVolume);
    updateMemberVolume(memberId, normalizedVolume);
    activeClient?.setPeerVolume(memberId, normalizedVolume);
    scheduleMemberVolumeSave(storageKey, normalizedVolume);
  };

  const addRoomCollectionItem = async (
    kind: RoomCollectionItem["kind"],
    title: string,
    content: string,
  ) => {
    if (!activeClient) throw new Error("signaling_not_connected");
    await activeClient.addRoomCollectionItem(kind, title, content);
    await writeRendererLog("signaling", "info", "Room collection item requested", {
      kind,
      title: title.slice(0, 80),
    });
  };

  const removeRoomCollectionItem = async (itemId: string) => {
    if (!activeClient) throw new Error("signaling_not_connected");
    await activeClient.removeRoomCollectionItem(itemId);
    await writeRendererLog("signaling", "info", "Room collection item removal requested", {
      itemId,
    });
  };

  return {
    room,
    localStream,
    joinChannel,
    switchChannel,
    leaveRoom,
    replaceInputDevice,
    setMicrophoneSendVolume,
    copyInviteLink,
    sendChatMessage,
    recallChatMessage,
    sendKnock,
    sendSceneReaction,
    sendQuickMessage,
    sendConfiguredQuickMessage,
    stopSharedQuickMessageMusic,
    startScreenShare,
    stopScreenShare,
    setScreenShareViewingActive,
    moveLocalMember,
    setMemberVolume,
    addRoomCollectionItem,
    removeRoomCollectionItem,
  };
};
