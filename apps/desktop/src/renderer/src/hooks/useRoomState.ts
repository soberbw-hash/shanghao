import { useEffect, useRef } from "react";

import {
  DEFAULT_CHANNEL_ID,
  HostSessionState,
  RoomConnectionState,
  RoomLifecycleState,
  type ConnectionMode,
  type HostSessionInfo,
  type RoomMember,
  type SignalingEventPayload,
} from "@private-voice/shared";
import { createSpeakingDetector, requestMicrophoneStream } from "@private-voice/webrtc";

import { RoomClient } from "../features/room/roomClient";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { buildShareableInviteUrl, isValidInviteUrl } from "../utils/invite";
import { writeRendererLog } from "../utils/logger";

let activeClient: RoomClient | null = null;
let activeSpeakingDetector: ReturnType<typeof createSpeakingDetector> | null = null;
let previousMemberIds = new Set<string>();

export const getRoomRuntimeDiagnostics = () => activeClient?.getDiagnostics();

const copy = {
  startHostTitle: "房间启动失败",
  joinRoomTitle: "加入房间失败",
  hostStartedTitle: "房间已启动",
  hostStartedDescription: "你已经进入房间，正在等待好友加入。",
  hostDirectReadyTitle: "公网直连已就绪",
  hostDirectReadyDescription: "现在可以直接复制房间地址发给朋友。",
  hostDirectLimitedTitle: "房间已启动",
  missingJoinUrl: "请先输入房主分享的地址。",
  invalidJoinUrl: "连接地址无效，请确认是房主发来的完整地址。",
  roomFull: "房间已满，最多支持 5 人同时语音。",
  networkFailed: "连接失败，请检查网络、代理或当前连接模式。",
  handshakeFailed: "地址已可达，但房间连接握手失败，可能受代理或 TUN 影响。",
  versionMismatch: "房主和成员版本不一致，请升级到同一版本。",
  relayAuthFailed: "云中继鉴权失败，请让房主重新分享房间地址。",
  microphoneUnavailable: "麦克风不可用",
  microphonePermission: "麦克风不可用，请先在系统设置里允许访问麦克风。",
  microphoneMissing: "没有找到可用的麦克风。",
  microphoneBusy: "麦克风正在被其他程序占用。",
  inputDeviceFailed: "输入设备切换失败",
  joinedRoomTitle: "已加入房间",
  joinedRoomDescription: "语音连接已经建立。",
  copiedAddressTitle: "已复制房间地址",
  copiedAddressDescription: "把这份地址发给朋友就能加入。",
} as const;

const parseInvite = (value: string, fallbackMode: ConnectionMode) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error("missing_join_url");
  }

  const url = new URL(trimmedValue);
  if (!isValidInviteUrl(url.toString())) {
    throw new Error("invalid_join_url");
  }

  const candidateUrls = [url.toString()];
  for (const candidate of url.searchParams.getAll("candidate")) {
    try {
      const candidateUrl = new URL(candidate);
      if (candidateUrl.protocol !== "ws:" && candidateUrl.protocol !== "wss:") {
        continue;
      }

      if (!candidateUrl.searchParams.get("roomId")) {
        candidateUrl.searchParams.set(
          "roomId",
          url.searchParams.get("roomId") || "private-room",
        );
      }
      if (!candidateUrl.searchParams.get("mode")) {
        candidateUrl.searchParams.set("mode", url.searchParams.get("mode") || fallbackMode);
      }

      candidateUrls.push(candidateUrl.toString());
    } catch {
      // Ignore malformed fallback candidates and keep trying the main address.
    }
  }

  return {
    signalingUrl: url.toString(),
    candidateUrls: [...new Set(candidateUrls)],
    roomId: url.searchParams.get("roomId") || "private-room",
    connectionMode: (url.searchParams.get("mode") as ConnectionMode | null) || fallbackMode,
    protocolVersion: url.searchParams.get("protocolVersion") ?? undefined,
    buildNumber: url.searchParams.get("buildNumber") ?? undefined,
  };
};

const normalizeRoomError = (error: unknown, fallback: string): string => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return copy.microphonePermission;
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return copy.microphoneMissing;
    }

    if (error.name === "NotReadableError") {
      return copy.microphoneBusy;
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message) {
      return fallback;
    }

    if (message === "missing_join_url" || message === "Invalid URL") {
      return copy.missingJoinUrl;
    }

    if (message === "invalid_join_url" || message.includes("Failed to construct 'URL'")) {
      return copy.invalidJoinUrl;
    }

    if (message.includes("version")) {
      return copy.versionMismatch;
    }

    if (message.includes("relay_auth_failed")) {
      return copy.relayAuthFailed;
    }

    if (message.includes("room_full")) {
      return copy.roomFull;
    }

    if (message === "join_ack_timeout") {
      return "服务器已连接，但没有确认加入房间。";
    }

    if (message === "room_snapshot_timeout") {
      return "已加入房间，但成员同步超时。";
    }

    return message;
  }

  return fallback;
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
  } catch {
    summary.messageType = "invalid_json";
  }
  return summary;
};

const applyHostSessionSnapshot = (
  session: HostSessionInfo | undefined,
  {
    setHostSession,
    setJoinSignalUrl,
    setConnectionMode,
    setRoom,
  }: {
    setHostSession: (session?: HostSessionInfo) => void;
    setJoinSignalUrl: (url: string) => void;
    setConnectionMode: (mode: ConnectionMode) => void;
    setRoom: (room: Partial<ReturnType<typeof useRoomStore.getState>["room"]>) => void;
  },
) => {
  setHostSession(session);

  if (!session) {
    setJoinSignalUrl("");
    return;
  }

  const inviteUrl = buildShareableInviteUrl(session);
  setJoinSignalUrl(inviteUrl);
  setConnectionMode(session.connectionMode);
  setRoom({
    signalingUrl: inviteUrl || undefined,
    hostAddress: session.hostAddress || undefined,
    hostSessionState: session.hostState,
  });
};

export const useRoomState = () => {
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const room = useRoomStore((state) => state.room);
  const hostSession = useRoomStore((state) => state.hostSession);
  const localStream = useRoomStore((state) => state.localStream);
  const joinSignalUrl = useRoomStore((state) => state.joinSignalUrl);
  const setJoinSignalUrl = useRoomStore((state) => state.setJoinSignalUrl);
  const setRoom = useRoomStore((state) => state.setRoom);
  const setMembers = useRoomStore((state) => state.setMembers);
  const setConnectionState = useRoomStore((state) => state.setConnectionState);
  const setLifecycleState = useRoomStore((state) => state.setLifecycleState);
  const setHostSession = useRoomStore((state) => state.setHostSession);
  const setConnectionMode = useRoomStore((state) => state.setConnectionMode);
  const setLocalStream = useRoomStore((state) => state.setLocalStream);
  const setRemoteStream = useRoomStore((state) => state.setRemoteStream);
  const pushHostEvent = useRoomStore((state) => state.pushHostEvent);
  const clearHostEvents = useRoomStore((state) => state.clearHostEvents);
  const addChatMessage = useRoomStore((state) => state.addChatMessage);
  const clearChatMessages = useRoomStore((state) => state.clearChatMessages);
  const setConnectionHealth = useRoomStore((state) => state.setConnectionHealth);
  const setLocalDiagnostics = useAudioStore((state) => state.setLocalDiagnostics);
  const isMuted = useAudioStore((state) => state.isMuted);
  const pushToast = useAppStore((state) => state.pushToast);
  const setRoomAction = useAppStore((state) => state.setRoomAction);

  const lastProbeSignatureRef = useRef("");
  const lastCopiedInviteRef = useRef("");

  useEffect(() => {
    activeClient?.updateMuteState(isMuted, false);
  }, [isMuted]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    activeClient?.updateProfile(settings.nickname, avatarDataUrl, settings.avatarId);
  }, [avatarDataUrl, settings?.avatarId, settings?.nickname]);

  useEffect(() => {
    const unsubscribe = window.desktopApi.host.onSessionUpdated((session) => {
      applyHostSessionSnapshot(session, {
        setHostSession,
        setJoinSignalUrl,
        setConnectionMode,
        setRoom,
      });

      if (!session || session.connectionMode !== "direct_host" || !session.directHostProbe) {
        return;
      }

      const probe = session.directHostProbe;
      const inviteUrl = buildShareableInviteUrl(session);
      const signature = `${probe.reachability}:${inviteUrl || "none"}`;
      if (lastProbeSignatureRef.current === signature) {
        return;
      }
      lastProbeSignatureRef.current = signature;

      if (probe.reachability === "pending") {
        pushHostEvent({ level: "info", message: probe.message });
        return;
      }

      if (probe.reachability === "reachable" && inviteUrl && probe.addressSource !== "lan_ipv4") {
        pushHostEvent({ level: "success", message: probe.message });
        pushToast({
          tone: "success",
          title: copy.hostDirectReadyTitle,
          description: copy.hostDirectReadyDescription,
        });

        if (
          settings?.shouldAutoCopyInviteLink &&
          lastCopiedInviteRef.current !== inviteUrl
        ) {
          lastCopiedInviteRef.current = inviteUrl;
          void navigator.clipboard.writeText(inviteUrl).catch(() => undefined);
        }
      } else if (inviteUrl && probe.addressSource === "lan_ipv4") {
        pushHostEvent({ level: "success", message: probe.message });
        pushToast({
          tone: "success",
          title: copy.hostStartedTitle,
          description: probe.message,
        });
      } else if (inviteUrl) {
        pushHostEvent({ level: "warning", message: probe.message });
        pushToast({
          tone: "warning",
          title: copy.hostDirectLimitedTitle,
          description: probe.message,
        });
      } else {
        pushHostEvent({ level: "warning", message: probe.message });
        pushToast({
          tone: "warning",
          title: copy.hostDirectLimitedTitle,
          description: probe.message,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [pushHostEvent, pushToast, setConnectionMode, setHostSession, setJoinSignalUrl, setRoom, settings?.shouldAutoCopyInviteLink]);

  const startSpeakingDetector = (stream: MediaStream) => {
    activeSpeakingDetector?.destroy();
    activeSpeakingDetector = createSpeakingDetector(stream, (isSpeaking) => {
      activeClient?.updateMuteState(useAudioStore.getState().isMuted, isSpeaking);
    });
  };

  const stopLocalMedia = () => {
    activeSpeakingDetector?.destroy();
    activeSpeakingDetector = null;
    useRoomStore
      .getState()
      .localStream?.getTracks()
      .forEach((track) => track.stop());
    setLocalStream(undefined);
  };

  const cleanupPreviousSession = async ({
    resetStore = false,
    stopHost = false,
  }: {
    resetStore?: boolean;
    stopHost?: boolean;
  } = {}) => {
    const client = activeClient;
    activeClient = null;
    if (client) {
      await client.disconnect().catch(() => undefined);
    }

    stopLocalMedia();
    previousMemberIds = new Set<string>();
    setConnectionHealth({ reconnectAttempt: 0 });
    if (stopHost) {
      await window.desktopApi.host.stop().catch(() => undefined);
    }
    if (resetStore) {
      useRoomStore.getState().resetRoom();
    }
  };

  const ensureLocalStream = async (preferredInputDeviceId?: string) => {
    const existingStream = useRoomStore.getState().localStream;
    existingStream?.getTracks().forEach((track) => track.stop());

    try {
      const { stream, diagnostics } = await requestMicrophoneStream({
        deviceId: preferredInputDeviceId ?? settings?.preferredInputDeviceId,
        noiseSuppression: settings?.isNoiseSuppressionEnabled ?? true,
        echoCancellation: settings?.isEchoCancellationEnabled ?? true,
        autoGainControl: settings?.isAutoGainControlEnabled ?? true,
        preferredSampleRate: settings?.preferredSampleRate ?? "auto",
      });

      setLocalStream(stream);
      setLocalDiagnostics(diagnostics);
      await writeRendererLog("audio", "info", "Acquired local microphone stream", {
        ...diagnostics,
      });
      return stream;
    } catch (error) {
      await writeRendererLog("audio", "error", "Failed to acquire local microphone stream", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(normalizeRoomError(error, copy.microphoneUnavailable));
    }
  };

  const connectToRoom = async ({
    connectUrl,
    inviteUrl,
    roomId,
    roomName,
    connectionMode,
    isFixedChannel = false,
    channelCode,
  }: {
    connectUrl: string;
    inviteUrl?: string;
    roomId: string;
    roomName: string;
    connectionMode: ConnectionMode;
    isFixedChannel?: boolean;
    channelCode?: string;
  }) => {
    const stream = await ensureLocalStream();

    const peerId = crypto.randomUUID();
    activeClient = new RoomClient({
      signalingUrl: connectUrl,
      roomId,
      peerId,
      nickname: settings?.nickname ?? "我",
      avatarDataUrl,
      avatarId: settings?.avatarId,
      isFixedChannel,
      channelCode,
      localStream: stream,
      connectionMode,
      appVersion: runtimeInfo?.version ?? "0.0.0",
      protocolVersion: runtimeInfo?.protocolVersion ?? "1",
      buildNumber: runtimeInfo?.buildNumber ?? "unknown",
      onMembers: (members) => {
        const { joined, left } = collectMemberEvents(members);
        const previousMembers = useRoomStore.getState().room.members;
        setMembers(members);

        joined.forEach((member) => {
          pushHostEvent({
            level: "success",
            memberName: member.nickname,
            message: `${member.nickname} 加入成功`,
          });
        });

        left.forEach((memberId) => {
          const leftMember = previousMembers.find((member) => member.id === memberId);
          pushHostEvent({
            level: "warning",
            memberName: leftMember?.nickname,
            message: `${leftMember?.nickname ?? "有成员"} 已离开`,
          });
        });
      },
      onRoomName: (nextRoomName) => setRoom({ roomName: nextRoomName }),
      onConnectionState: (state) => {
        setConnectionState(state);
        if (state === RoomConnectionState.WaitingSnapshot) {
          pushHostEvent({
            level: "info",
            message: "已连接，正在同步成员…",
          });
        }
        if (state === RoomConnectionState.WaitingPeer) {
          pushHostEvent({
            level: "info",
            message: "等待好友加入",
          });
        }
      },
      onReconnectAttempt: (attempt) => {
        setConnectionHealth({ reconnectAttempt: attempt, lastUpdatedAt: new Date().toISOString() });
        pushHostEvent({
          level: "warning",
          message: `连接有波动，正在第 ${attempt} 次重连…`,
        });
      },
      onReconnectExhausted: (error) => {
        void writeRendererLog("signaling", "error", "Signaling reconnect exhausted", {
          roomId,
          peerId,
          error: error.message,
        });
        void cleanupPreviousSession({ resetStore: true, stopHost: true }).then(() => {
          setConnectionState(RoomConnectionState.Failed, "连接已断开，请重新加入房间。");
          setLifecycleState(RoomLifecycleState.Failed);
          pushToast({
            tone: "danger",
            title: "连接已断开",
            description: "自动重连未成功，音频已经安全停止，请重新开房或加入。",
          });
          useAppStore.getState().navigate("home");
        });
      },
      onSnapshotRevision: (revision) => {
        setConnectionHealth({ lastUpdatedAt: new Date().toISOString() });
        void writeRendererLog("signaling", "info", "Applied room snapshot", {
          roomId,
          peerId,
          revision,
        });
      },
      onRtt: (latencyMs) => {
        setConnectionHealth({ latencyMs, lastUpdatedAt: new Date().toISOString() });
      },
      onRemoteStream: (remotePeerId, remoteStream) => {
        setRemoteStream(remotePeerId, remoteStream);
      },
      onChatMessage: (message) => {
        addChatMessage(message);
      },
      onDiagnosticEvent: (payload) => {
        void writeRendererLog("signaling", "info", "Signaling bridge event", {
          ...summarizeSignalingEvent(payload),
        });
      },
    });

    setRoom({
      roomId,
      roomName,
      connectionMode,
      lifecycleState: RoomLifecycleState.Opening,
      signalingUrl: inviteUrl || undefined,
      hostSessionState: HostSessionState.Starting,
      latestFailureReason: undefined,
    });

    await activeClient.connect();
    setRoom({
      roomId,
      roomName,
      connectionMode,
      lifecycleState: RoomLifecycleState.Open,
      signalingUrl: inviteUrl || undefined,
      hostSessionState: HostSessionState.Active,
      latestFailureReason: undefined,
    });
    startSpeakingDetector(stream);
  };

  const connectToAnyCandidate = async ({
    candidateUrls,
    inviteUrl,
    roomId,
    roomName,
    connectionMode,
  }: {
    candidateUrls: string[];
    inviteUrl: string;
    roomId: string;
    roomName: string;
    connectionMode: ConnectionMode;
  }) => {
    let lastError: unknown;

    for (const [index, candidateUrl] of candidateUrls.entries()) {
      try {
        await writeRendererLog("signaling", "info", "Trying signaling candidate", {
          candidateUrl,
          index,
          total: candidateUrls.length,
          connectionMode,
        });
        await connectToRoom({
          connectUrl: candidateUrl,
          inviteUrl,
          roomId,
          roomName,
          connectionMode,
        });
        if (index > 0) {
          pushHostEvent({
            level: "success",
            message: "备用地址连接成功",
          });
        }
        return candidateUrl;
      } catch (error) {
        lastError = error;
        await writeRendererLog("signaling", "warn", "Signaling candidate failed", {
          candidateUrl,
          index,
          total: candidateUrls.length,
          connectionMode,
          error: error instanceof Error ? error.message : String(error),
          ...activeClient?.getDiagnostics(),
        });
        await cleanupPreviousSession();
      }
    }

    throw lastError instanceof Error ? lastError : new Error(copy.networkFailed);
  };

  const diagnoseJoinFailure = async (
    signalingUrl: string,
    connectionMode: ConnectionMode,
    error: unknown,
  ) => {
    try {
      let parsedMode = connectionMode;
      try {
        parsedMode =
          (new URL(signalingUrl).searchParams.get("mode") as ConnectionMode | null) ??
          connectionMode;
      } catch {
        // URL validation is handled by diagnoseJoin.
      }
      const diagnostic = await window.desktopApi.host.diagnoseJoin(signalingUrl, parsedMode);
      await writeRendererLog("signaling", "warn", "Join failure diagnostic", {
        ...diagnostic,
        parsedMode,
        currentSelectedMode: connectionMode,
        rawError: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message === "join_ack_timeout") {
        return "服务器已连接，但没有确认加入房间。";
      }

      if (error instanceof Error && error.message === "room_snapshot_timeout") {
        return "已加入房间，但成员同步超时。";
      }

      if (!diagnostic.isUrlValid) {
        return diagnostic.message;
      }

      if (!diagnostic.isReachable) {
        return "无法连接到房主地址";
      }

      if (diagnostic.failureStage === "websocket") {
        return copy.handshakeFailed;
      }

      return diagnostic.message;
    } catch (diagnosticError) {
      await writeRendererLog("signaling", "warn", "Failed to run join diagnostic", {
        error:
          diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      });
      return normalizeRoomError(error, copy.networkFailed);
    }
  };

  const startHost = async () => {
    if (!settings) {
      return;
    }

    setRoomAction("starting");
    setConnectionState(RoomConnectionState.StartingHost);
    setLifecycleState(RoomLifecycleState.Opening);
    clearHostEvents();
    clearChatMessages();
    lastProbeSignatureRef.current = "";
    pushHostEvent({ level: "info", message: "正在启动房间" });

    try {
      await cleanupPreviousSession({ stopHost: true });
      await writeRendererLog("connection-mode", "info", "Starting host room", {
        roomName: room.roomName,
        connectionMode: settings.connectionMode,
      });

      const session = await window.desktopApi.host.start(
        room.roomName,
        settings.nickname,
        settings.connectionMode,
      );
      const shareableInviteUrl = buildShareableInviteUrl(session);
      const hostJoinUrl = session.localSignalingUrl || shareableInviteUrl;

      applyHostSessionSnapshot(session, {
        setHostSession,
        setJoinSignalUrl,
        setConnectionMode,
        setRoom,
      });

      await connectToRoom({
        connectUrl: hostJoinUrl,
        inviteUrl: shareableInviteUrl,
        roomId: session.roomId,
        roomName: session.roomName,
        connectionMode: session.connectionMode,
      });

      if (shareableInviteUrl) {
        try {
          await navigator.clipboard.writeText(shareableInviteUrl);
          lastCopiedInviteRef.current = shareableInviteUrl;
          pushToast({
            tone: "success",
            title: copy.copiedAddressTitle,
            description: copy.copiedAddressDescription,
          });
        } catch {
          // noop
        }
      }

      useAppStore.getState().navigate("room");
      pushToast({
        tone: "success",
        title: copy.hostStartedTitle,
        description:
          session.connectionMode === "direct_host"
            ? session.directHostProbe?.message ?? copy.hostStartedDescription
            : copy.hostStartedDescription,
      });
    } catch (error) {
      const description = normalizeRoomError(error, copy.startHostTitle);
      await writeRendererLog("signaling", "error", "Failed to start host room", {
        connectionMode: settings.connectionMode,
        error: error instanceof Error ? error.message : String(error),
      });
      await window.desktopApi.host.stop().catch(() => undefined);
      await cleanupPreviousSession({ stopHost: true });
      setHostSession(undefined);
      setConnectionState(RoomConnectionState.Failed, description);
      setRoom({
        lifecycleState: RoomLifecycleState.Failed,
        signalingUrl: undefined,
        hostSessionState: HostSessionState.Failed,
      });
      pushHostEvent({ level: "error", message: description });
      pushToast({
        tone: "danger",
        title: copy.startHostTitle,
        description,
      });
    } finally {
      setRoomAction("idle");
    }
  };

  const joinRoom = async (inviteValue = joinSignalUrl) => {
    if (!settings) {
      return;
    }

    setRoomAction("joining");
    setConnectionState(RoomConnectionState.Joining);
    setLifecycleState(RoomLifecycleState.Opening);

    try {
      await cleanupPreviousSession({ stopHost: true });
      const invite = parseInvite(inviteValue, settings.connectionMode);
      setConnectionMode(invite.connectionMode);
      await writeRendererLog("connection-mode", "info", "Joining room", invite);
      clearChatMessages();

      const connectedUrl = await connectToAnyCandidate({
        candidateUrls: invite.candidateUrls,
        inviteUrl: invite.signalingUrl,
        roomId: invite.roomId,
        roomName: room.roomName,
        connectionMode: invite.connectionMode,
      });

      setJoinSignalUrl(invite.signalingUrl);
      await writeRendererLog("signaling", "info", "Joined room through signaling candidate", {
        connectedUrl,
        advertisedUrl: invite.signalingUrl,
        candidateCount: invite.candidateUrls.length,
      });
      useAppStore.getState().navigate("room");
      pushToast({
        tone: "success",
        title: copy.joinedRoomTitle,
        description: copy.joinedRoomDescription,
      });
    } catch (error) {
      const currentMode = room.connectionMode || settings.connectionMode;
      const description = await diagnoseJoinFailure(inviteValue, currentMode, error);
      await writeRendererLog("signaling", "error", "Failed to join room", {
        connectionMode: currentMode,
        error: error instanceof Error ? error.message : String(error),
        signalingUrl: inviteValue,
      });
      await cleanupPreviousSession();
      setConnectionState(RoomConnectionState.Failed, description);
      setRoom({ lifecycleState: RoomLifecycleState.Failed });
      pushToast({
        tone: "danger",
        title: copy.joinRoomTitle,
        description,
      });
    } finally {
      setRoomAction("idle");
    }
  };

  const joinChannel = async () => {
    if (!settings) {
      return;
    }

    const serverUrl = settings.relayServerUrl?.trim();
    if (!serverUrl) {
      pushToast({
        tone: "warning",
        title: "还没有设置频道服务器",
        description: "请先在设置的高级连接里填写固定频道服务器地址。",
      });
      useAppStore.getState().navigate("settings");
      return;
    }

    setRoomAction("joining");
    setConnectionState(RoomConnectionState.Joining);
    setLifecycleState(RoomLifecycleState.Opening);
    clearHostEvents();
    clearChatMessages();
    pushHostEvent({ level: "info", message: "正在进入开黑频道" });

    try {
      await cleanupPreviousSession({ stopHost: true });
      await writeRendererLog("signaling", "info", "Joining fixed channel", {
        channelId: DEFAULT_CHANNEL_ID,
        connectionMode: "relay",
        hasChannelCode: Boolean(settings.channelAccessCode),
      });
      await connectToRoom({
        connectUrl: serverUrl,
        roomId: DEFAULT_CHANNEL_ID,
        roomName: settings.roomName,
        connectionMode: "relay",
        isFixedChannel: true,
        channelCode: settings.channelAccessCode,
      });
      setConnectionMode("relay");
      useAppStore.getState().navigate("room");
      pushToast({
        tone: "success",
        title: "已进入开黑频道",
        description: "好友上线后会自动出现在队伍里。",
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const description =
        rawMessage.includes("频道码") || rawMessage.includes("channel_code_invalid")
          ? "频道码不正确，请向好友确认后重试。"
          : normalizeRoomError(error, "暂时无法进入频道，请检查服务器设置后重试。");
      await writeRendererLog("signaling", "error", "Failed to join fixed channel", {
        channelId: DEFAULT_CHANNEL_ID,
        hasChannelCode: Boolean(settings.channelAccessCode),
        error: rawMessage,
      });
      await cleanupPreviousSession();
      setConnectionState(RoomConnectionState.Failed, description);
      setRoom({ lifecycleState: RoomLifecycleState.Failed });
      pushToast({ tone: "danger", title: "进入频道失败", description });
    } finally {
      setRoomAction("idle");
    }
  };

  const replaceInputDevice = async (preferredInputDeviceId?: string) => {
    if (!activeClient || !settings) {
      return;
    }

    try {
      const { stream, diagnostics } = await requestMicrophoneStream({
        deviceId: preferredInputDeviceId ?? settings.preferredInputDeviceId,
        noiseSuppression: settings.isNoiseSuppressionEnabled,
        echoCancellation: settings.isEchoCancellationEnabled,
        autoGainControl: settings.isAutoGainControlEnabled,
        preferredSampleRate: settings.preferredSampleRate,
      });
      const [nextTrack] = stream.getAudioTracks();
      if (!nextTrack) {
        throw new Error(copy.microphoneMissing);
      }

      setLocalDiagnostics(diagnostics);
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
    }
  };

  const leaveRoom = async () => {
    try {
      setLifecycleState(RoomLifecycleState.Closing);
      await cleanupPreviousSession({ resetStore: true, stopHost: true });
      previousMemberIds = new Set<string>();
      lastProbeSignatureRef.current = "";
      lastCopiedInviteRef.current = "";
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
    const inviteUrl = buildShareableInviteUrl(hostSession) || room.signalingUrl;

    if (!inviteUrl || !isValidInviteUrl(inviteUrl)) {
      pushToast({
        tone: "warning",
        title: "当前还没有真实可分享地址",
        description: "请等待地址验证完成，或切换到临时公网、Tailscale / 云中继模式。",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteUrl);
      lastCopiedInviteRef.current = inviteUrl;
      pushToast({
        tone: "success",
        title: copy.copiedAddressTitle,
        description: copy.copiedAddressDescription,
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
        title: "还没进入房间",
        description: "开启房间或加入房间后，才能和队友聊天。",
      });
      return;
    }

    if (!activeClient.canSendChat()) {
      pushToast({
        tone: "warning",
        title: "正在重连",
        description: "信令恢复后再发送消息。",
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

  return {
    room,
    joinSignalUrl,
    setJoinSignalUrl,
    startHost,
    joinRoom,
    joinChannel,
    leaveRoom,
    replaceInputDevice,
    copyInviteLink,
    sendChatMessage,
  };
};
