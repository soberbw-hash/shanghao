import { useEffect, useMemo, useRef } from "react";

import { RoomConnectionState, RoomLifecycleState } from "@private-voice/shared";
import { createSpeakingDetector, requestMicrophoneStream } from "@private-voice/webrtc";

import { RoomClient } from "../features/room/roomClient";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { writeRendererLog } from "../utils/logger";

const copy = {
  startHostTitle: "\u623f\u95f4\u542f\u52a8\u5931\u8d25",
  joinRoomTitle: "\u52a0\u5165\u623f\u95f4\u5931\u8d25",
  hostStartedTitle: "\u623f\u95f4\u5df2\u5f00\u542f",
  hostStartedDescription:
    "\u628a\u5730\u5740\u53d1\u7ed9\u670b\u53cb\uff0c\u5bf9\u65b9\u7c98\u8d34\u540e\u5c31\u80fd\u52a0\u5165\u3002",
  missingJoinUrl:
    "\u8bf7\u5148\u8f93\u5165\u623f\u4e3b\u5206\u4eab\u7684\u5730\u5740\u3002",
  invalidJoinUrl:
    "\u8fde\u63a5\u5730\u5740\u65e0\u6548\uff0c\u8bf7\u786e\u8ba4\u662f\u623f\u4e3b\u53d1\u6765\u7684\u5730\u5740\u3002",
  missingHostAddress:
    "\u65e0\u6cd5\u83b7\u53d6\u672c\u673a\u8fde\u63a5\u5730\u5740",
  roomFull:
    "\u623f\u95f4\u5df2\u6ee1\uff0c\u6700\u591a\u53ea\u652f\u6301 5 \u4eba\u540c\u65f6\u8bed\u97f3\u3002",
  networkFailed:
    "\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 Tailscale \u6216\u7f51\u7edc\u73af\u5883\u3002",
  microphoneUnavailable:
    "\u9ea6\u514b\u98ce\u4e0d\u53ef\u7528",
  microphonePermission:
    "\u9ea6\u514b\u98ce\u4e0d\u53ef\u7528\uff0c\u8bf7\u5148\u5141\u8bb8\u7cfb\u7edf\u9ea6\u514b\u98ce\u6743\u9650\u3002",
  microphoneMissing:
    "\u6ca1\u6709\u627e\u5230\u53ef\u7528\u7684\u9ea6\u514b\u98ce\u3002",
  microphoneBusy:
    "\u9ea6\u514b\u98ce\u5f53\u524d\u88ab\u5176\u4ed6\u7a0b\u5e8f\u5360\u7528\u3002",
  inputDeviceFailed:
    "\u8f93\u5165\u8bbe\u5907\u5207\u6362\u5931\u8d25",
  invalidPayload:
    "\u623f\u95f4\u8fd4\u56de\u7684\u6570\u636e\u65e0\u6cd5\u8bc6\u522b\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002",
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

    if (message.includes("\u623f\u95f4\u5df2\u6ee1")) {
      return copy.roomFull;
    }

    if (message.includes("\u9ea6\u514b\u98ce")) {
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

  const clientRef = useRef<RoomClient | null>(null);
  const speakingRef = useRef<ReturnType<typeof createSpeakingDetector> | null>(null);
  const peerId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    clientRef.current?.updateMuteState(isMuted, false);
  }, [isMuted]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    useRoomStore.getState().syncLocalProfile({
      nickname: settings.nickname,
      avatarPath: settings.avatarPath,
      avatarDataUrl,
    });

    clientRef.current?.updateProfile(settings.nickname, avatarDataUrl);
  }, [avatarDataUrl, settings?.avatarPath, settings?.nickname]);

  const startSpeakingDetector = (stream: MediaStream) => {
    speakingRef.current?.destroy();
    speakingRef.current = createSpeakingDetector(stream, (isSpeaking) => {
      clientRef.current?.updateMuteState(useAudioStore.getState().isMuted, isSpeaking);
    });
  };

  const stopLocalMedia = () => {
    speakingRef.current?.destroy();
    speakingRef.current = null;
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

    clientRef.current?.disconnect();
    clientRef.current = new RoomClient({
      signalingUrl,
      roomId,
      peerId,
      nickname: settings?.nickname ?? "\u6211",
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

    await clientRef.current.connect();
    setRoom({
      roomId,
      roomName,
      lifecycleState: RoomLifecycleState.Open,
      signalingUrl,
    });
    startSpeakingDetector(stream);
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
      clientRef.current = null;
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
    } catch (error) {
      const description = normalizeRoomError(error, copy.networkFailed);
      await writeRendererLog("signaling", "error", "Failed to join room", {
        error: error instanceof Error ? error.message : String(error),
        signalingUrl,
      });
      stopLocalMedia();
      clientRef.current = null;
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
    if (!clientRef.current || !settings) {
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
      await clientRef.current.replaceInputTrack(nextTrack);
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
      speakingRef.current?.destroy();
      localStream?.getTracks().forEach((track) => track.stop());
      clientRef.current?.disconnect();
      clientRef.current = null;
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
