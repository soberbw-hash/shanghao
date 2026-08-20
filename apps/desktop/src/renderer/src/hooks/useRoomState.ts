import { useEffect } from "react";

import {
  DEFAULT_CHANNEL_ID,
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
import {
  createSpeakingDetector,
  requestMicrophoneStream,
  type ScreenShareEncodingProfile,
} from "@private-voice/webrtc";

import {
  createProcessedMicrophoneStream,
  type ProcessedMicrophoneStream,
} from "../features/audio/microphoneProcessor";
import { REMOTE_AUDIO_LEVEL_EVENT } from "../features/audio/RemoteAudioMixer";
import { getRemoteAudioMixer } from "../features/audio/RemoteAudioMixer";
import { clampMemberVolume } from "../features/audio/memberVolume";
import { playUiSound } from "../features/audio/uiSound";
import { playAnimalCall } from "../features/audio/animalCall";
import { RoomClient } from "../features/room/roomClient";
import { encodeQuickReplyTarget, QUICK_REPLY_COOLDOWN_MS } from "../features/chat/quickReplies";
import { persistChatHistory, type ChannelId } from "../features/chat/chatPersistence";
import {
  runtimeMemberVolumes,
  scheduleMemberVolumeSave,
} from "../features/room/memberVolumePersistence";
import {
  describeChatNotification,
  playSceneReactionSound,
  sendSystemNotification,
} from "../features/room/roomNotifications";
import { useRoomDeepLink } from "../features/room/useRoomDeepLink";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { useDailyRoomReportStore } from "../store/dailyRoomReportStore";
import { writeRendererLog } from "../utils/logger";

let activeClient: RoomClient | null = null;
let activeJoinPromise: Promise<void> | null = null;
let activeSpeakingDetector: ReturnType<typeof createSpeakingDetector> | null = null;
let activeProcessedMicrophone: ProcessedMicrophoneStream | null = null;
let previousMemberIds = new Set<string>();
const CHANNEL_IDS = new Set<ChannelId>(["main", "side"]);
let lastQuickMessageSentAt = 0;
const ROUTINE_SIGNAL_MESSAGE_TYPES = new Set([
  "audio_chunk",
  "member_state",
  "pong",
  "screen_frame",
]);

export const getRoomRuntimeDiagnostics = () => activeClient?.getDiagnostics();

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
  joinAckTimeout: "服务器已连接，但没有确认加入频道，可能是服务端版本不兼容。",
  snapshotTimeout: "已进入频道，但同步成员超时，请重试。",
  versionMismatch: "当前版本太旧，请更新后再进入频道。",
  microphoneUnavailable: "麦克风不可用",
  microphonePermission: "麦克风不可用，请先在系统设置里允许访问麦克风。",
  microphoneMissing: "没有找到可用的麦克风。",
  microphoneBusy: "麦克风正在被其他程序占用。",
  inputDeviceFailed: "输入设备切换失败",
  copiedInviteDescription: "把链接发给朋友，点击就会打开上号并进入当前房间。",
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

export const buildChannelInviteText = ({ channelId }: { channelId: string }) => {
  const invite = new URL("shanghao://join");
  invite.searchParams.set("room", CHANNEL_IDS.has(channelId as ChannelId) ? channelId : "main");
  invite.searchParams.set("expires", String(Date.now() + 10 * 60_000));
  return invite.toString();
};

const collectMemberEvents = (members: RoomMember[]) => {
  const nextIds = new Set(
    members.filter((member) => !member.isEmptySlot && !member.isLocal).map((member) => member.id),
  );
  const joined = members.filter(
    (member) => !member.isEmptySlot && !member.isLocal && !previousMemberIds.has(member.id),
  );
  const left = [...previousMemberIds].filter((memberId) => !nextIds.has(memberId));
  previousMemberIds = nextIds;
  return { joined, left };
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
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
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
  const setChannelCounts = useRoomStore((state) => state.setChannelCounts);
  const clearChannelContent = useRoomStore((state) => state.clearChannelContent);
  const setConnectionHealth = useRoomStore((state) => state.setConnectionHealth);
  const updatePeerLatency = useRoomStore((state) => state.updatePeerLatency);
  const updateMemberVolume = useRoomStore((state) => state.updateMemberVolume);
  const updateLocalPresence = useRoomStore((state) => state.updateLocalPresence);
  const setLocalDiagnostics = useAudioStore((state) => state.setLocalDiagnostics);
  const isMuted = useAudioStore((state) => state.isMuted);
  const isDeafened = useAudioStore((state) => state.isDeafened);
  const pushToast = useAppStore((state) => state.pushToast);
  const setRoomAction = useAppStore((state) => state.setRoomAction);

  useEffect(() => {
    const localSpeakingState = useRoomStore
      .getState()
      .room.members.find((member) => member.isLocal)?.speakingState;
    const isSpeaking = !isMuted && localSpeakingState === MemberSpeakingState.Speaking;
    updateLocalPresence({
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
      localMember?.workActivity,
    );
  }, [isDeafened, isMuted, updateLocalPresence]);

  const profileNickname = settings?.nickname;
  const profileAvatarId = settings?.avatarId;
  useEffect(() => {
    if (!profileNickname) {
      return;
    }

    activeClient?.updateProfile(profileNickname, avatarDataUrl, profileAvatarId);
  }, [avatarDataUrl, profileAvatarId, profileNickname]);

  const startSpeakingDetector = (stream: MediaStream) => {
    activeSpeakingDetector?.destroy();
    activeSpeakingDetector = createSpeakingDetector(
      stream,
      (isSpeaking) => {
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
        window.dispatchEvent(
          new CustomEvent(REMOTE_AUDIO_LEVEL_EVENT, {
            detail: { peerId: "local-member", level },
          }),
        );
      },
    );
  };

  const stopLocalMedia = () => {
    activeSpeakingDetector?.destroy();
    activeSpeakingDetector = null;
    activeProcessedMicrophone?.dispose();
    activeProcessedMicrophone = null;
    useRoomStore
      .getState()
      .localStream?.getTracks()
      .forEach((track) => track.stop());
    setLocalStream(undefined);
  };

  const cleanupPreviousSession = async ({
    resetStore = false,
    preserveLocalMedia = false,
  }: { resetStore?: boolean; preserveLocalMedia?: boolean } = {}) => {
    const client = activeClient;
    activeClient = null;
    if (client) {
      await client.disconnect().catch(() => undefined);
    }

    if (!preserveLocalMedia) {
      stopLocalMedia();
    }
    previousMemberIds = new Set<string>();
    setConnectionHealth({ reconnectAttempt: 0 });
    if (resetStore) {
      useRoomStore.getState().resetRoom();
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

    const currentSettings = useSettingsStore.getState().settings ?? settings;
    activeProcessedMicrophone?.dispose();
    activeProcessedMicrophone = null;

    try {
      const { stream: inputStream, diagnostics } = await requestMicrophoneStream({
        deviceId: preferredInputDeviceId ?? currentSettings?.preferredInputDeviceId,
        // DeepFilterNet is the only suppression engine. Browser suppression stays off so
        // a failed model load can safely preserve unprocessed microphone audio.
        noiseSuppression: false,
        echoCancellation: currentSettings?.isEchoCancellationEnabled ?? true,
        autoGainControl: currentSettings?.isAutoGainControlEnabled ?? true,
      });
      const processedMicrophone = await createProcessedMicrophoneStream(inputStream, {
        micEqualizerGains: currentSettings?.micEqualizerGains ?? [0, 0, 0, 0, 0],
        lowCutFrequency: currentSettings?.lowCutFrequency ?? "90",
        isNoiseSuppressionEnabled: currentSettings?.isNoiseSuppressionEnabled ?? true,
        isVoiceEnhancementEnabled: currentSettings?.isVoiceEnhancementEnabled ?? true,
        microphoneSendVolume: currentSettings?.microphoneSendVolume ?? 1,
        getRemoteReferenceLevel: () => getRemoteAudioMixer().getRemoteReferenceLevel(),
      });
      activeProcessedMicrophone = processedMicrophone;
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
      await writeRendererLog("audio", "error", "Failed to acquire local microphone stream", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(normalizeRoomError(error, copy.microphoneUnavailable), {
        cause: error,
      });
    }
  };

  const connectToFixedChannel = async (
    serverUrl: string,
    channelId: ChannelId,
    { reuseLocalMedia = false }: { reuseLocalMedia?: boolean } = {},
  ) => {
    const currentSettings = useSettingsStore.getState().settings ?? settings;
    const stream = await ensureLocalStream(undefined, { reuseExisting: reuseLocalMedia });
    const peerId = crypto.randomUUID();
    const profileId = currentSettings?.profileId || crypto.randomUUID();
    if (currentSettings && !currentSettings.profileId) {
      await useSettingsStore.getState().saveSettings({ profileId });
    }
    const roomName = currentSettings?.roomName ?? room.roomName;

    activeClient = new RoomClient({
      signalingUrl: serverUrl,
      roomId: channelId,
      peerId,
      profileId,
      nickname: currentSettings?.nickname || "我",
      avatarDataUrl: undefined,
      avatarId: currentSettings?.avatarId,
      localStream: stream,
      appVersion: runtimeInfo?.version ?? "0.0.0",
      protocolVersion: runtimeInfo?.protocolVersion ?? "1",
      buildNumber: runtimeInfo?.buildNumber ?? "unknown",
      onMembers: (members) => {
        const { joined, left } = collectMemberEvents(members);
        const previousMembers = useRoomStore.getState().room.members;
        const savedVolumes = useSettingsStore.getState().settings?.memberVolumes ?? {};
        const audioState = useAudioStore.getState();
        const nicknameCounts = new Map<string, number>();
        for (const member of members) {
          nicknameCounts.set(member.nickname, (nicknameCounts.get(member.nickname) ?? 0) + 1);
        }
        const membersWithVolume = members.map((member) => {
          const storageKey = member.profileId || member.nickname;
          const legacyNicknameVolume =
            member.profileId &&
            nicknameCounts.get(member.nickname) === 1 &&
            savedVolumes[member.profileId] === undefined
              ? savedVolumes[member.nickname]
              : undefined;
          if (member.profileId && legacyNicknameVolume !== undefined) {
            scheduleMemberVolumeSave(member.profileId, legacyNicknameVolume, member.nickname);
          }
          const volume = clampMemberVolume(
            runtimeMemberVolumes.get(storageKey) ??
              savedVolumes[storageKey] ??
              legacyNicknameVolume ??
              member.volume ??
              1,
          );
          if (!member.isLocal) return { ...member, volume };

          return {
            ...member,
            volume,
            isMuted: audioState.isMuted,
            isDeafened: audioState.isDeafened,
            speakingState: audioState.isMuted
              ? MemberSpeakingState.Muted
              : member.speakingState === MemberSpeakingState.Muted
                ? MemberSpeakingState.Silent
                : member.speakingState,
          };
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
      onRoomName: (nextRoomName) => setRoom({ roomName: nextRoomName }),
      onConnectionState: (state) => {
        setConnectionState(state);
        if (state === RoomConnectionState.WaitingSnapshot) {
          pushRoomEvent({ level: "info", message: "已连接，正在同步成员…" });
        }
        if (state === RoomConnectionState.WaitingPeer) {
          pushRoomEvent({ level: "info", message: "等待好友加入" });
        }
      },
      onReconnectAttempt: (attempt) => {
        setConnectionHealth({ reconnectAttempt: attempt, lastUpdatedAt: new Date().toISOString() });
        pushRoomEvent({ level: "warning", message: `连接有波动，正在第 ${attempt} 次重连…` });
      },
      onReconnectExhausted: (error) => {
        const protocolRejected = error.message === "signaling_protocol_rejected";
        void writeRendererLog("signaling", "error", "Signaling reconnect exhausted", {
          roomId: channelId,
          peerId,
          error: error.message,
        });
        void (async () => {
          await cleanupPreviousSession({ resetStore: true });
          setConnectionState(RoomConnectionState.Failed, "连接已断开，请重新进入频道。");
          setLifecycleState(RoomLifecycleState.Failed);
          pushToast({
            tone: "danger",
            title: protocolRejected ? "连接数据被服务器拒绝" : "连接已断开",
            description: protocolRejected
              ? "客户端与服务器的数据格式不一致，已停止反复重连。请导出诊断包后再试。"
              : "自动重连未成功，音频已经安全停止，请重新进入频道。",
          });
          useAppStore.getState().navigate("home");
        })();
      },
      onUpdateRequired: (requiredVersion, currentVersion) => {
        useAppStore.getState().requireUpdate(requiredVersion, currentVersion);
      },
      onAvatarConflict: (availableAvatarIds) => {
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
        setConnectionHealth({ lastUpdatedAt: new Date().toISOString() });
        void writeRendererLog("signaling", "info", "Applied fixed channel snapshot", {
          roomId: channelId,
          peerId,
          revision,
        });
      },
      onRtt: (latencyMs) => {
        setConnectionHealth({ latencyMs, lastUpdatedAt: new Date().toISOString() });
        updatePeerLatency(peerId, latencyMs);
      },
      onPeerLatency: updatePeerLatency,
      onPeerStats: (statsByPeer) => {
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
        setRemoteStream(remotePeerId, remoteStream);
      },
      onRemoteScreenFrame: (remotePeerId, frame) => {
        setRemoteScreenFrame(remotePeerId, frame);
      },
      onRemoteScreenShareState: setRemoteScreenSharing,
      onSceneReaction: (reaction) => {
        addSceneReaction(reaction);
        if (reaction.targetPeerId === peerId && reaction.peerId !== peerId) {
          playSceneReactionSound("receive-message");
        }
      },
      onQuickMessage: (message) => {
        addQuickMessage(message);
        const currentSettings = useSettingsStore.getState().settings;
        if (!message.isLocal && currentSettings?.isUiSoundEnabled !== false) {
          playAnimalCall(message.avatarId, currentSettings?.soundVolume ?? 0.72, message.content);
        }
        if (!message.isLocal && currentSettings?.isSystemNotificationEnabled !== false) {
          sendSystemNotification({
            title: `${message.nickname} 提醒你`,
            body: message.content,
          });
        }
      },
      onChatMessage: (message) => {
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
        removeChatMessage(messageId);
        persistChatHistory(serverUrl, channelId);
      },
      onChatHistory: (messages) => {
        mergeChatHistory(messages);
        persistChatHistory(serverUrl, channelId);
      },
      onChannelCounts: setChannelCounts,
      onDailyRoomReports: (targetRoomId, reports) =>
        useDailyRoomReportStore.getState().setReports(targetRoomId, reports),
      onRoomCollection: (items, replace) => {
        if (replace) setCollectionItems(items);
        else mergeCollectionItems(items);
      },
      onKnock: (message) => {
        addChatMessage(message);
        persistChatHistory(serverUrl, channelId);
        playUiSound("knock-bell");
        window.setTimeout(() => playUiSound("knock-bell"), 190);
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

    await activeClient.connect();
    useDailyRoomReportStore.getState().beginLoading();
    const reportClient = activeClient;
    void Promise.allSettled([
      reportClient.requestDailyRoomReports("main"),
      reportClient.requestDailyRoomReports("side"),
    ]).then((reportRequests) => {
      if (activeClient !== reportClient) return;
      const unavailableRooms = (["main", "side"] as const).filter((_, index) => {
        const result = reportRequests[index];
        return result?.status === "rejected" || result?.value === false;
      });
      if (unavailableRooms.length) {
        useDailyRoomReportStore.getState().setUnavailable([...unavailableRooms]);
      }
    });
    const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
    activeClient.updateMuteState(useAudioStore.getState().isMuted, false);
    activeClient.updatePresenceState(
      useAudioStore.getState().isDeafened,
      localMember?.activity ?? "idle",
      localMember?.sceneZone,
      localMember?.gameName,
      localMember?.musicActivity,
      localMember?.gameIconDataUrl,
      localMember?.workActivity,
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
    serverUrlOverride?: string,
    requestedChannelId: ChannelId = DEFAULT_CHANNEL_ID,
  ): Promise<void> => {
    if (activeJoinPromise) {
      void writeRendererLog("signaling", "info", "Ignored duplicate fixed channel join request");
      return activeJoinPromise;
    }

    const joinPromise = (async () => {
      const currentSettings = useSettingsStore.getState().settings ?? settings;
      if (!currentSettings) {
        return;
      }
      if (useAppStore.getState().requiredUpdate) {
        useAppStore.getState().enterUpdateGate();
        return;
      }
      const channelId = CHANNEL_IDS.has(requestedChannelId)
        ? requestedChannelId
        : DEFAULT_CHANNEL_ID;

      let serverUrl: string;
      try {
        serverUrl = normalizeServerUrl(serverUrlOverride || currentSettings.relayServerUrl);
      } catch (error) {
        const description = normalizeRoomError(error, copy.joinTitle);
        pushToast({ tone: "warning", title: copy.joinTitle, description });
        return;
      }

      setRoomAction("joining");
      setConnectionState(RoomConnectionState.Joining);
      setRoom({
        roomId: channelId,
        roomName: channelId === "main" ? "一号房" : "二号房",
        lifecycleState: RoomLifecycleState.Opening,
        signalingUrl: serverUrl,
      });
      clearRoomEvents();
      pushRoomEvent({
        level: "info",
        message: `正在进入${channelId === "main" ? "一号房" : "二号房"}`,
      });

      try {
        const reuseLocalMedia = Boolean(
          activeClient &&
          activeProcessedMicrophone?.stream
            .getAudioTracks()
            .some((track) => track.readyState === "live"),
        );
        await cleanupPreviousSession({ preserveLocalMedia: reuseLocalMedia });
        clearChannelContent();
        const readChatHistory = window.desktopApi?.app?.readChatHistory;
        const cachedMessages =
          typeof readChatHistory === "function"
            ? await readChatHistory({ serverUrl, channelId }).catch((error) => {
                void writeRendererLog("app", "warn", "Failed to restore local chat history", {
                  channelId,
                  error: error instanceof Error ? error.message : String(error),
                });
                return [];
              })
            : [];
        mergeChatHistory(cachedMessages);
        await writeRendererLog("signaling", "info", "Joining fixed channel", {
          serverUrl,
          channelId,
        });
        await connectToFixedChannel(serverUrl, channelId, { reuseLocalMedia });
        useAppStore.getState().navigate("room");
        pushToast({
          tone: "success",
          title: copy.joinedTitle,
          description: copy.joinedDescription,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "CLIENT_UPDATE_REQUIRED") {
          await cleanupPreviousSession();
          return;
        }
        const description = normalizeRoomError(error, copy.networkFailed);
        await writeRendererLog("signaling", "error", "Failed to join fixed channel", {
          serverUrl,
          channelId,
          error: error instanceof Error ? error.message : String(error),
          ...activeClient?.getDiagnostics(),
        });
        await cleanupPreviousSession();
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
    return joinChannel(room.signalingUrl || settings?.relayServerUrl, channelId);
  };

  useRoomDeepLink({
    onInvite: async (invite) => {
      const storedServerUrl = useSettingsStore.getState().settings?.relayServerUrl;
      const normalizedServerUrl = normalizeServerUrl(invite.serverUrl || storedServerUrl);
      if (!normalizedServerUrl) throw new Error("missing_saved_server");
      if (invite.serverUrl && storedServerUrl !== normalizedServerUrl) {
        await useSettingsStore.getState().saveSettings({ relayServerUrl: normalizedServerUrl });
      }
      await joinChannel(normalizedServerUrl, invite.channelId);
    },
    onError: (error) => {
      pushToast({
        tone: "warning",
        title: "邀请链接无法打开",
        description: normalizeRoomError(error, "请让朋友重新发送邀请链接。"),
      });
    },
  });

  const replaceInputDevice = async (preferredInputDeviceId?: string) => {
    const currentSettings = useSettingsStore.getState().settings ?? settings;
    if (!activeClient || !currentSettings) {
      return;
    }

    try {
      const { stream: inputStream, diagnostics } = await requestMicrophoneStream({
        deviceId: preferredInputDeviceId ?? currentSettings.preferredInputDeviceId,
        noiseSuppression: false,
        echoCancellation: currentSettings.isEchoCancellationEnabled,
        autoGainControl: currentSettings.isAutoGainControlEnabled,
      });
      const processedMicrophone = await createProcessedMicrophoneStream(
        inputStream,
        currentSettings,
      );
      const stream = processedMicrophone.stream;
      const [nextTrack] = stream.getAudioTracks();
      if (!nextTrack) {
        processedMicrophone.dispose();
        throw new Error(copy.microphoneMissing);
      }

      activeProcessedMicrophone?.dispose();
      activeProcessedMicrophone = processedMicrophone;
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
      await activeClient.replaceInputTrack(nextTrack);
      startSpeakingDetector(stream);
      await writeRendererLog("devices", "info", "Switched input device", {
        preferredInputDeviceId,
        ...diagnostics,
      });
    } catch (error) {
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
    }
  };

  const setMicrophoneSendVolume = (volume: number) => {
    activeProcessedMicrophone?.setSendVolume(volume);
  };

  const leaveRoom = async () => {
    try {
      playUiSound("leave-room");
      setLifecycleState(RoomLifecycleState.Closing);
      if (settings) {
        useRoomStore.getState().syncLocalProfile({
          nickname: settings.nickname,
          avatarPath: settings.avatarPath,
          avatarDataUrl,
          avatarId: settings.avatarId,
        });
      }
      useAppStore.getState().navigate("home");
      await cleanupPreviousSession({ resetStore: true });
      previousMemberIds = new Set<string>();
    } catch (error) {
      await writeRendererLog("signaling", "error", "Failed to leave room cleanly", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const copyInviteLink = async () => {
    try {
      const inviteText = buildChannelInviteText({
        channelId: room.roomId || DEFAULT_CHANNEL_ID,
      });
      await window.desktopApi.clipboard.writeText(inviteText);
      playUiSound("copy-success");
      await writeRendererLog("app", "info", "Copied fixed channel invite", {
        channelId: room.roomId || DEFAULT_CHANNEL_ID,
        temporary: true,
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
    if ((!trimmed && !image) || !settings) {
      return;
    }

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
        persistChatHistory(
          historyServerUrl,
          CHANNEL_IDS.has(activeRoom.roomId as ChannelId)
            ? (activeRoom.roomId as ChannelId)
            : "main",
        );
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

  const sendQuickMessage = async (content: string) => {
    const targetPeerId = encodeQuickReplyTarget(content);
    if (!targetPeerId || !activeClient?.canSendChat()) {
      throw new Error("signaling_not_connected");
    }
    const now = Date.now();
    if (now - lastQuickMessageSentAt < QUICK_REPLY_COOLDOWN_MS) return;
    lastQuickMessageSentAt = now;

    const currentSettings = useSettingsStore.getState().settings;
    if (currentSettings?.isUiSoundEnabled !== false) {
      playAnimalCall(currentSettings?.avatarId, currentSettings?.soundVolume ?? 0.72, content);
    }
    await activeClient.sendSceneReaction(targetPeerId, "👍");
  };

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

  const moveLocalMember = (
    sceneZone: SceneZoneId,
    activity: MemberActivity,
    gameName?: string,
    musicActivity?: RoomMember["musicActivity"],
    gameIconDataUrl?: string,
    workActivity?: RoomMember["workActivity"],
  ) => {
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
      workActivity,
    });
    activeClient?.updatePresenceState(
      isDeafened,
      activity,
      sceneZone,
      gameName,
      musicActivity,
      gameIconDataUrl,
      workActivity,
    );
    void writeRendererLog("app", "info", "Local member moved in scene", {
      sceneZone,
      activity,
      gameName,
      musicProvider: musicActivity?.provider,
      workApp: workActivity?.id,
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
    startScreenShare,
    stopScreenShare,
    moveLocalMember,
    setMemberVolume,
    addRoomCollectionItem,
    removeRoomCollectionItem,
  };
};
