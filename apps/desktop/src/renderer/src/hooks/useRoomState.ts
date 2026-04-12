import { useEffect } from "react";

import {
  HostSessionState,
  RoomConnectionState,
  RoomLifecycleState,
  type ConnectionMode,
  type RoomMember,
} from "@private-voice/shared";
import { createSpeakingDetector, requestMicrophoneStream } from "@private-voice/webrtc";

import { RoomClient } from "../features/room/roomClient";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { writeRendererLog } from "../utils/logger";

const sharedPeerId = crypto.randomUUID();
let activeClient: RoomClient | null = null;
let activeSpeakingDetector: ReturnType<typeof createSpeakingDetector> | null = null;
let previousMemberIds = new Set<string>();

const copy = {
  startHostTitle: "房间启动失败",
  joinRoomTitle: "加入房间失败",
  hostStartedTitle: "房间已开启",
  hostStartedDescription: "地址已经生成，正在等待好友加入。",
  missingJoinUrl: "请先输入房主分享的地址。",
  invalidJoinUrl: "连接地址无效，请确认是房主发来的完整地址。",
  roomFull: "房间已满，最多只支持 5 人同时语音。",
  networkFailed: "连接失败，请检查网络、代理/TUN 或当前模式。",
  handshakeFailed: "地址已可达，但房间连接握手失败，可能受代理/TUN 影响。",
  versionMismatch: "房主和成员版本不一致，请升级到同一版本。",
  relayAuthFailed: "云中继鉴权失败，请让房主重新分享房间地址。",
  microphoneUnavailable: "麦克风不可用",
  microphonePermission: "麦克风不可用，请先允许系统麦克风权限。",
  microphoneMissing: "没有找到可用的麦克风。",
  microphoneBusy: "麦克风当前被其他程序占用。",
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
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("invalid_join_url");
  }

  return {
    signalingUrl: url.toString(),
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

export const useRoomState = () => {
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const room = useRoomStore((state) => state.room);
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
  const setLocalDiagnostics = useAudioStore((state) => state.setLocalDiagnostics);
  const isMuted = useAudioStore((state) => state.isMuted);
  const pushToast = useAppStore((state) => state.pushToast);
  const setRoomAction = useAppStore((state) => state.setRoomAction);

  useEffect(() => {
    activeClient?.updateMuteState(isMuted, false);
  }, [isMuted]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    activeClient?.updateProfile(settings.nickname, avatarDataUrl);
  }, [avatarDataUrl, settings?.nickname]);

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
    signalingUrl,
    roomId,
    roomName,
    connectionMode,
  }: {
    signalingUrl: string;
    roomId: string;
    roomName: string;
    connectionMode: ConnectionMode;
  }) => {
    const stream = await ensureLocalStream();

    activeClient?.disconnect();
    activeClient = new RoomClient({
      signalingUrl,
      roomId,
      peerId: sharedPeerId,
      nickname: settings?.nickname ?? "我",
      avatarDataUrl,
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
        if (state === RoomConnectionState.WaitingPeer) {
          pushHostEvent({
            level: "info",
            message: "等待好友加入",
          });
        }
      },
      onRemoteStream: (remotePeerId, remoteStream) => {
        setRemoteStream(remotePeerId, remoteStream);
      },
      onDiagnosticEvent: (payload) => {
        void writeRendererLog("signaling", "info", "Signaling bridge event", {
          ...payload,
        });
      },
    });

    setRoom({
      roomId,
      roomName,
      connectionMode,
      lifecycleState: RoomLifecycleState.Opening,
      signalingUrl,
      hostSessionState: HostSessionState.Starting,
    });

    await activeClient.connect();
    setRoom({
      roomId,
      roomName,
      connectionMode,
      lifecycleState: RoomLifecycleState.Open,
      signalingUrl,
      hostSessionState: HostSessionState.Active,
    });
    startSpeakingDetector(stream);
  };

  const diagnoseJoinFailure = async (
    signalingUrl: string,
    connectionMode: ConnectionMode,
    error: unknown,
  ) => {
    try {
      const diagnostic = await window.desktopApi.host.diagnoseJoin(signalingUrl, connectionMode);
      await writeRendererLog("signaling", "warn", "Join failure diagnostic", {
        ...diagnostic,
        rawError: error instanceof Error ? error.message : String(error),
      });

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
        error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
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
    pushHostEvent({ level: "info", message: "正在启动房间" });

    try {
      await writeRendererLog("connection-mode", "info", "Starting host room", {
        roomName: room.roomName,
        connectionMode: settings.connectionMode,
      });

      const session = await window.desktopApi.host.start(
        room.roomName,
        settings.nickname,
        settings.connectionMode,
      );
      setHostSession(session);
      setJoinSignalUrl(session.signalingUrl);
      setConnectionMode(session.connectionMode);
      setRoom({
        signalingUrl: session.signalingUrl,
        hostAddress: session.hostAddress,
        hostSessionState: session.hostState,
      });

      await connectToRoom({
        signalingUrl: session.signalingUrl,
        roomId: session.roomId,
        roomName: session.roomName,
        connectionMode: session.connectionMode,
      });

      if (settings.shouldAutoCopyInviteLink) {
        void navigator.clipboard.writeText(session.signalingUrl).then(() => {
          pushToast({
            tone: "success",
            title: copy.copiedAddressTitle,
            description: copy.copiedAddressDescription,
          });
        });
      }

      useAppStore.getState().navigate("room");
      pushToast({
        tone: "success",
        title: copy.hostStartedTitle,
        description:
          session.connectionMode === "direct_host" && session.directHostProbe?.reachability !== "reachable"
            ? `${copy.hostStartedDescription} ${session.directHostProbe?.message ?? ""}`.trim()
            : copy.hostStartedDescription,
      });
    } catch (error) {
      const description = normalizeRoomError(error, copy.startHostTitle);
      await writeRendererLog("signaling", "error", "Failed to start host room", {
        connectionMode: settings.connectionMode,
        error: error instanceof Error ? error.message : String(error),
      });
      await window.desktopApi.host.stop().catch(() => undefined);
      stopLocalMedia();
      activeClient = null;
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
      const invite = parseInvite(inviteValue, settings.connectionMode);
      setConnectionMode(invite.connectionMode);
      await writeRendererLog("connection-mode", "info", "Joining room", invite);

      await connectToRoom({
        signalingUrl: invite.signalingUrl,
        roomId: invite.roomId,
        roomName: room.roomName,
        connectionMode: invite.connectionMode,
      });

      setJoinSignalUrl(invite.signalingUrl);
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
      stopLocalMedia();
      activeClient = null;
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
      activeSpeakingDetector?.destroy();
      localStream?.getTracks().forEach((track) => track.stop());
      activeClient?.disconnect();
      activeClient = null;
      activeSpeakingDetector = null;
      await window.desktopApi.host.stop().catch(() => undefined);
      useRoomStore.getState().resetRoom();
      previousMemberIds = new Set<string>();
      if (settings) {
        useRoomStore.getState().syncLocalProfile({
          nickname: settings.nickname,
          avatarPath: settings.avatarPath,
          avatarDataUrl,
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
    if (!room.signalingUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(room.signalingUrl);
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

  return {
    room,
    joinSignalUrl,
    setJoinSignalUrl,
    startHost,
    joinRoom,
    leaveRoom,
    replaceInputDevice,
    copyInviteLink,
  };
};
