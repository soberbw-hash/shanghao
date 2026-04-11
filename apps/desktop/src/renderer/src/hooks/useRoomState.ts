import { useEffect } from "react";

import { RoomConnectionState, RoomLifecycleState } from "@private-voice/shared";
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

const copy = {
  startHostTitle: "房间启动失败",
  joinRoomTitle: "加入房间失败",
  hostStartedTitle: "房间已开启",
  hostStartedDescription: "地址已经生成，正在等待好友加入。",
  missingJoinUrl: "请先输入房主分享的地址。",
  invalidJoinUrl: "连接地址无效，请确认是房主发来的完整地址。",
  missingHostAddress: "无法获取本机连接地址",
  roomFull: "房间已满，最多只支持 5 人同时语音。",
  networkFailed: "连接失败，请检查 Tailscale 或网络环境。",
  handshakeFailed: "已经找到房主地址，但连接没有建立成功，请让房主重新开房。",
  microphoneUnavailable: "麦克风不可用",
  microphonePermission: "麦克风不可用，请先允许系统麦克风权限。",
  microphoneMissing: "没有找到可用的麦克风。",
  microphoneBusy: "麦克风当前被其他程序占用。",
  inputDeviceFailed: "输入设备切换失败",
  invalidPayload: "房间返回的数据无法识别，请稍后再试。",
  joinedRoomTitle: "已加入房间",
  joinedRoomDescription: "语音连接已经建立。",
} as const;

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

    if (message === "network_unreachable") {
      return copy.networkFailed;
    }

    if (message === "invalid_signaling_payload") {
      return copy.invalidPayload;
    }

    if (message.includes(copy.missingHostAddress)) {
      return copy.missingHostAddress;
    }

    if (message.includes("room_full") || message.includes("房间已满")) {
      return copy.roomFull;
    }

    if (message.includes("麦克风")) {
      return message;
    }

    return message;
  }

  return fallback;
};

const validateSignalingUrl = (value: string): string => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    throw new Error("missing_join_url");
  }

  const url = new URL(trimmedValue);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("invalid_join_url");
  }

  return url.toString();
};

export const useRoomState = () => {
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const room = useRoomStore((state) => state.room);
  const localStream = useRoomStore((state) => state.localStream);
  const joinSignalUrl = useRoomStore((state) => state.joinSignalUrl);
  const setJoinSignalUrl = useRoomStore((state) => state.setJoinSignalUrl);
  const setRoom = useRoomStore((state) => state.setRoom);
  const setMembers = useRoomStore((state) => state.setMembers);
  const setConnectionState = useRoomStore((state) => state.setConnectionState);
  const setHostSession = useRoomStore((state) => state.setHostSession);
  const setLocalStream = useRoomStore((state) => state.setLocalStream);
  const setRemoteStream = useRoomStore((state) => state.setRemoteStream);
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
  }: {
    signalingUrl: string;
    roomId: string;
    roomName: string;
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
      onMembers: (members) => setMembers(members),
      onRoomName: (nextRoomName) => setRoom({ roomName: nextRoomName }),
      onConnectionState: (state) => setConnectionState(state),
      onRemoteStream: (remotePeerId, remoteStream) => {
        setRemoteStream(remotePeerId, remoteStream);
      },
    });

    setRoom({
      roomId,
      roomName,
      lifecycleState: RoomLifecycleState.Opening,
      signalingUrl,
    });

    await activeClient.connect();
    setRoom({
      roomId,
      roomName,
      lifecycleState: RoomLifecycleState.Open,
      signalingUrl,
    });
    startSpeakingDetector(stream);
  };

  const diagnoseJoinFailure = async (signalingUrl: string, error: unknown) => {
    try {
      const diagnostic = await window.desktopApi.host.diagnoseJoin(signalingUrl);
      await writeRendererLog("signaling", "warn", "Join failure diagnostic", {
        ...diagnostic,
        rawError: error instanceof Error ? error.message : String(error),
      });

      if (!diagnostic.isUrlValid) {
        return diagnostic.message;
      }

      if (!diagnostic.isReachable) {
        return copy.networkFailed;
      }

      return copy.handshakeFailed;
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
    setRoom({ lifecycleState: RoomLifecycleState.Opening });

    try {
      await writeRendererLog("signaling", "info", "Starting host room", {
        roomName: room.roomName,
      });

      const session = await window.desktopApi.host.start(room.roomName, settings.nickname);
      const signalingUrl = validateSignalingUrl(session.signalingUrl);

      setHostSession(session);
      setJoinSignalUrl(signalingUrl);

      await connectToRoom({
        signalingUrl,
        roomId: session.roomId,
        roomName: session.roomName,
      });

      useAppStore.getState().navigate("room");
      pushToast({
        tone: "success",
        title: copy.hostStartedTitle,
        description: copy.hostStartedDescription,
      });
    } catch (error) {
      const description = normalizeRoomError(error, copy.startHostTitle);
      await writeRendererLog("signaling", "error", "Failed to start host room", {
        error: error instanceof Error ? error.message : String(error),
      });
      await window.desktopApi.host.stop().catch(() => undefined);
      stopLocalMedia();
      activeClient = null;
      setHostSession(undefined);
      setConnectionState(RoomConnectionState.Failed);
      setRoom({
        lifecycleState: RoomLifecycleState.Closed,
        signalingUrl: undefined,
      });
      pushToast({
        tone: "danger",
        title: copy.startHostTitle,
        description,
      });
    } finally {
      setRoomAction("idle");
    }
  };

  const joinRoom = async (signalingUrl = joinSignalUrl, roomId = room.roomId) => {
    if (!settings) {
      return;
    }

    setRoomAction("joining");
    setConnectionState(RoomConnectionState.Joining);

    try {
      const normalizedUrl = validateSignalingUrl(signalingUrl);
      await writeRendererLog("signaling", "info", "Joining room", {
        signalingUrl: normalizedUrl,
      });

      await connectToRoom({
        signalingUrl: normalizedUrl,
        roomId,
        roomName: room.roomName,
      });

      setJoinSignalUrl(normalizedUrl);
      useAppStore.getState().navigate("room");
      pushToast({
        tone: "success",
        title: copy.joinedRoomTitle,
        description: copy.joinedRoomDescription,
      });
    } catch (error) {
      const description = await diagnoseJoinFailure(signalingUrl, error);
      await writeRendererLog("signaling", "error", "Failed to join room", {
        error: error instanceof Error ? error.message : String(error),
        signalingUrl,
      });
      stopLocalMedia();
      activeClient = null;
      setConnectionState(RoomConnectionState.Failed);
      setRoom({
        lifecycleState: RoomLifecycleState.Closed,
      });
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

  return {
    room,
    joinSignalUrl,
    setJoinSignalUrl,
    startHost,
    joinRoom,
    leaveRoom,
    replaceInputDevice,
  };
};
