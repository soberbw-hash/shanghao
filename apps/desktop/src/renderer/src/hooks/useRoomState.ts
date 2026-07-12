import { useEffect } from "react";

import {
  DEFAULT_CHANNEL_ID,
  RoomConnectionState,
  RoomLifecycleState,
  type MemberActivity,
  type RoomMember,
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
import { playUiSound } from "../features/audio/uiSound";
import { RoomClient } from "../features/room/roomClient";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { writeRendererLog } from "../utils/logger";

let activeClient: RoomClient | null = null;
let activeSpeakingDetector: ReturnType<typeof createSpeakingDetector> | null = null;
let activeProcessedMicrophone: ProcessedMicrophoneStream | null = null;
let previousMemberIds = new Set<string>();

export const getRoomRuntimeDiagnostics = () => activeClient?.getDiagnostics();

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
  copiedInviteTitle: "服务器地址已复制",
  copiedInviteDescription: "把这个地址发给朋友，填写后即可进入同一个频道。",
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
    if (message === "network_unreachable") return copy.networkFailed;
    if (message === "signaling_socket_closed") return copy.socketClosed;
    if (message === "join_ack_timeout") return copy.joinAckTimeout;
    if (message === "room_snapshot_timeout") return copy.snapshotTimeout;
    if (message === "signaling_not_connected") return "连接还没恢复，请稍后再试。";
    return message;
  }

  return fallback;
};

export const buildChannelInviteText = ({ serverUrl }: { channelId: string; serverUrl: string }) =>
  serverUrl;

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
  const pushRoomEvent = useRoomStore((state) => state.pushRoomEvent);
  const clearRoomEvents = useRoomStore((state) => state.clearRoomEvents);
  const addChatMessage = useRoomStore((state) => state.addChatMessage);
  const mergeChatHistory = useRoomStore((state) => state.mergeChatHistory);
  const addSceneReaction = useRoomStore((state) => state.addSceneReaction);
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
    activeClient?.updateMuteState(isMuted, false);
  }, [isMuted]);

  useEffect(() => {
    updateLocalPresence({ isDeafened });
    const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
    activeClient?.updatePresenceState(
      isDeafened,
      localMember?.activity ?? "idle",
      localMember?.sceneZone,
      localMember?.gameName,
    );
  }, [isDeafened, updateLocalPresence]);

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
        activeClient?.updateMuteState(useAudioStore.getState().isMuted, isSpeaking);
      },
      useSettingsStore.getState().settings?.inputLevelThreshold ?? 0.4,
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

  const cleanupPreviousSession = async ({ resetStore = false }: { resetStore?: boolean } = {}) => {
    const client = activeClient;
    activeClient = null;
    if (client) {
      await client.disconnect().catch(() => undefined);
    }

    stopLocalMedia();
    previousMemberIds = new Set<string>();
    setConnectionHealth({ reconnectAttempt: 0 });
    if (resetStore) {
      useRoomStore.getState().resetRoom();
    }
  };

  const ensureLocalStream = async (preferredInputDeviceId?: string) => {
    const currentSettings = useSettingsStore.getState().settings ?? settings;
    activeProcessedMicrophone?.dispose();
    activeProcessedMicrophone = null;

    try {
      const { stream: inputStream, diagnostics } = await requestMicrophoneStream({
        deviceId: preferredInputDeviceId ?? currentSettings?.preferredInputDeviceId,
        // RNNoise owns suppression in an AudioWorklet. Browser suppression is enabled only
        // if the worklet cannot initialize, avoiding two aggressive processors in series.
        noiseSuppression: false,
        echoCancellation: currentSettings?.isEchoCancellationEnabled ?? true,
        autoGainControl: currentSettings?.isAutoGainControlEnabled ?? true,
        preferredSampleRate: currentSettings?.preferredSampleRate ?? "auto",
      });
      const processedMicrophone = await createProcessedMicrophoneStream(inputStream, {
        micEqualizerGains: currentSettings?.micEqualizerGains ?? [0, 0, 0, 0, 0],
        preferredSampleRate: currentSettings?.preferredSampleRate ?? "auto",
        lowCutFrequency: currentSettings?.lowCutFrequency ?? "90",
        isNoiseSuppressionEnabled: currentSettings?.isNoiseSuppressionEnabled ?? true,
      });
      activeProcessedMicrophone = processedMicrophone;
      const stream = processedMicrophone.stream;

      setLocalStream(stream);
      setLocalDiagnostics({ ...diagnostics, ...processedMicrophone.processorDiagnostics });
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

  const connectToFixedChannel = async (serverUrl: string) => {
    const currentSettings = useSettingsStore.getState().settings ?? settings;
    const stream = await ensureLocalStream();
    const peerId = crypto.randomUUID();
    const roomName = currentSettings?.roomName ?? room.roomName;

    activeClient = new RoomClient({
      signalingUrl: serverUrl,
      roomId: DEFAULT_CHANNEL_ID,
      peerId,
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
        const membersWithVolume = members.map((member) => ({
          ...member,
          volume: Math.max(0, Math.min(2, savedVolumes[member.nickname] ?? member.volume ?? 1)),
        }));
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
            void window.desktopApi.app.notify({
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
        void writeRendererLog("signaling", "error", "Signaling reconnect exhausted", {
          roomId: DEFAULT_CHANNEL_ID,
          peerId,
          error: error.message,
        });
        void (async () => {
          await cleanupPreviousSession({ resetStore: true });
          setConnectionState(RoomConnectionState.Failed, "连接已断开，请重新进入频道。");
          setLifecycleState(RoomLifecycleState.Failed);
          pushToast({
            tone: "danger",
            title: "连接已断开",
            description: "自动重连未成功，音频已经安全停止，请重新进入频道。",
          });
          useAppStore.getState().navigate("home");
        })();
      },
      onSnapshotRevision: (revision) => {
        setConnectionHealth({ lastUpdatedAt: new Date().toISOString() });
        void writeRendererLog("signaling", "info", "Applied fixed channel snapshot", {
          roomId: DEFAULT_CHANNEL_ID,
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
        const usesTurn = snapshots.some((snapshot) => snapshot.connectionType === "relay");
        setConnectionHealth({
          jitterMs,
          packetLossPercent,
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
      onSceneReaction: (reaction) => {
        addSceneReaction(reaction);
        if (reaction.targetPeerId === peerId && reaction.peerId !== peerId) {
          playUiSound("receive-message");
        }
      },
      onChatMessage: (message) => {
        addChatMessage(message);
        if (!message.isLocal) {
          playUiSound("receive-message");
        }
      },
      onChatHistory: (messages) => mergeChatHistory(messages),
      onKnock: (message) => {
        addChatMessage(message);
        playUiSound("knock-bell");
        if (!message.isLocal) {
          pushToast({
            tone: "neutral",
            title: `${message.nickname} 敲了敲你`,
            description: "上号啦",
          });
          if (useSettingsStore.getState().settings?.isSystemNotificationEnabled !== false) {
            void window.desktopApi.app.notify({
              title: `${message.nickname} 敲了敲你`,
              body: "上号啦",
            });
          }
        }
      },
      onDiagnosticEvent: (payload) => {
        void writeRendererLog("signaling", "info", "Signaling bridge event", {
          ...summarizeSignalingEvent(payload),
        });
      },
    });

    setRoom({
      roomId: DEFAULT_CHANNEL_ID,
      roomName,
      lifecycleState: RoomLifecycleState.Opening,
      signalingUrl: serverUrl,
      latestFailureReason: undefined,
    });

    await activeClient.connect();
    const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
    activeClient.updateMuteState(useAudioStore.getState().isMuted, false);
    activeClient.updatePresenceState(
      useAudioStore.getState().isDeafened,
      localMember?.activity ?? "idle",
      localMember?.sceneZone,
      localMember?.gameName,
    );
    playUiSound("enter-room");
    setRoom({
      roomId: DEFAULT_CHANNEL_ID,
      roomName,
      lifecycleState: RoomLifecycleState.Open,
      signalingUrl: serverUrl,
      latestFailureReason: undefined,
    });
    startSpeakingDetector(stream);
  };

  const joinChannel = async (serverUrlOverride?: string) => {
    const currentSettings = useSettingsStore.getState().settings ?? settings;
    if (!currentSettings) {
      return;
    }

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
    setLifecycleState(RoomLifecycleState.Opening);
    clearRoomEvents();
    pushRoomEvent({ level: "info", message: "正在进入固定频道" });

    try {
      await cleanupPreviousSession();
      await writeRendererLog("signaling", "info", "Joining fixed channel", {
        serverUrl,
        channelId: DEFAULT_CHANNEL_ID,
      });
      await connectToFixedChannel(serverUrl);
      useAppStore.getState().navigate("room");
      pushToast({
        tone: "success",
        title: copy.joinedTitle,
        description: copy.joinedDescription,
      });
    } catch (error) {
      const description = normalizeRoomError(error, copy.networkFailed);
      await writeRendererLog("signaling", "error", "Failed to join fixed channel", {
        serverUrl,
        channelId: DEFAULT_CHANNEL_ID,
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
  };

  const replaceInputDevice = async (preferredInputDeviceId?: string) => {
    if (!activeClient || !settings) {
      return;
    }

    try {
      const { stream: inputStream, diagnostics } = await requestMicrophoneStream({
        deviceId: preferredInputDeviceId ?? settings.preferredInputDeviceId,
        noiseSuppression: false,
        echoCancellation: settings.isEchoCancellationEnabled,
        autoGainControl: settings.isAutoGainControlEnabled,
        preferredSampleRate: settings.preferredSampleRate,
      });
      const processedMicrophone = await createProcessedMicrophoneStream(inputStream, settings);
      const stream = processedMicrophone.stream;
      const [nextTrack] = stream.getAudioTracks();
      if (!nextTrack) {
        processedMicrophone.dispose();
        throw new Error(copy.microphoneMissing);
      }

      activeProcessedMicrophone?.dispose();
      activeProcessedMicrophone = processedMicrophone;
      setLocalDiagnostics({ ...diagnostics, ...processedMicrophone.processorDiagnostics });
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

  const leaveRoom = async () => {
    try {
      playUiSound("leave-room");
      setLifecycleState(RoomLifecycleState.Closing);
      await cleanupPreviousSession({ resetStore: true });
      previousMemberIds = new Set<string>();
      if (settings) {
        useRoomStore.getState().syncLocalProfile({
          nickname: settings.nickname,
          avatarPath: settings.avatarPath,
          avatarDataUrl,
          avatarId: settings.avatarId,
        });
      }
      useAppStore.getState().navigate("home");
    } catch (error) {
      await writeRendererLog("signaling", "error", "Failed to leave room cleanly", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const copyInviteLink = async () => {
    const serverUrl = room.signalingUrl || settings?.relayServerUrl?.trim();

    if (!serverUrl) {
      pushToast({
        tone: "warning",
        title: "还没有服务器地址",
        description: "填写服务器地址并进入频道后再复制。",
      });
      return;
    }

    try {
      const inviteText = buildChannelInviteText({
        channelId: room.roomId || DEFAULT_CHANNEL_ID,
        serverUrl,
      });
      await window.desktopApi.clipboard.writeText(inviteText);
      playUiSound("copy-success");
      await writeRendererLog("app", "info", "Copied fixed channel invite", {
        channelId: room.roomId || DEFAULT_CHANNEL_ID,
        hasServerUrl: true,
      });
      pushToast({
        tone: "success",
        title: copy.copiedInviteTitle,
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

  const sendChatMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !settings) {
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

    try {
      await activeClient.sendChatMessage(trimmed);
    } catch (error) {
      await writeRendererLog("signaling", "warn", "Chat message send failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      pushToast({
        tone: "danger",
        title: "消息发送失败",
        description: "正在重连，请稍后再试。",
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

  const sendSceneReaction = async (targetPeerId: string, emoji: "👍" | "🔥" | "😂" | "❤️") => {
    if (!activeClient?.canSendChat()) {
      return;
    }
    await activeClient.sendSceneReaction(targetPeerId, emoji);
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

  const moveLocalMember = (sceneZone: SceneZoneId, activity: MemberActivity, gameName?: string) => {
    if (sceneZone === "restroomZone") {
      useAudioStore.getState().setMuted(true);
      activeClient?.updateMuteState(true, false);
    }
    updateLocalPresence({ sceneZone, activity, gameName });
    activeClient?.updatePresenceState(isDeafened, activity, sceneZone, gameName);
    void writeRendererLog("app", "info", "Local member moved in scene", {
      sceneZone,
      activity,
      gameName,
    });
  };

  const setMemberVolume = (memberId: string, volume: number) => {
    const normalizedVolume = Math.max(0, Math.min(2, volume));
    const member = useRoomStore
      .getState()
      .room.members.find((candidate) => candidate.id === memberId);
    if (!member || member.isLocal || member.isEmptySlot) return;
    updateMemberVolume(memberId, normalizedVolume);
    activeClient?.setPeerVolume(memberId, normalizedVolume);
    const currentSettings = useSettingsStore.getState().settings;
    if (currentSettings) {
      void useSettingsStore.getState().saveSettings({
        memberVolumes: {
          ...currentSettings.memberVolumes,
          [member.nickname]: normalizedVolume,
        },
      });
    }
  };

  return {
    room,
    localStream,
    joinChannel,
    leaveRoom,
    replaceInputDevice,
    copyInviteLink,
    sendChatMessage,
    sendKnock,
    sendSceneReaction,
    startScreenShare,
    stopScreenShare,
    moveLocalMember,
    setMemberVolume,
  };
};
