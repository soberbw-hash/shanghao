import { useEffect, useMemo, useRef } from "react";

import { RoomConnectionState, RoomLifecycleState } from "@private-voice/shared";
import { createSpeakingDetector, requestMicrophoneStream } from "@private-voice/webrtc";

import { RoomClient } from "../features/room/roomClient";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { writeRendererLog } from "../utils/logger";

export const useRoomState = () => {
  const settings = useSettingsStore((state) => state.settings);
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

  const clientRef = useRef<RoomClient | null>(null);
  const speakingRef = useRef<ReturnType<typeof createSpeakingDetector> | null>(null);

  const peerId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    clientRef.current?.updateMuteState(isMuted, false);
  }, [isMuted]);

  const ensureLocalStream = async () => {
    localStream?.getTracks().forEach((track) => track.stop());

    const { stream, diagnostics } = await requestMicrophoneStream({
      deviceId: settings?.preferredInputDeviceId,
      noiseSuppression: settings?.isNoiseSuppressionEnabled ?? true,
    });
    setLocalStream(stream);
    setLocalDiagnostics(diagnostics);
    await writeRendererLog("audio", "info", "Acquired local microphone stream", {
      ...diagnostics,
    });
    return stream;
  };

  const startHost = async () => {
    if (!settings) {
      return;
    }

    setConnectionState(RoomConnectionState.StartingHost);
    const session = await window.desktopApi.host.start(room.roomName, settings.nickname);
    setHostSession(session);
    setJoinSignalUrl(session.signalingUrl);
    setRoom({
      roomId: session.roomId,
      roomName: session.roomName,
      lifecycleState: RoomLifecycleState.Open,
      signalingUrl: session.signalingUrl,
    });
    useAppStore.getState().navigate("room");
    await joinRoom(session.signalingUrl, session.roomId);
  };

  const joinRoom = async (signalingUrl = joinSignalUrl, roomId = room.roomId) => {
    if (!settings || !signalingUrl) {
      return;
    }

    const stream = await ensureLocalStream();
    setRoom({
      roomId,
      roomName: room.roomName,
      lifecycleState: RoomLifecycleState.Open,
      signalingUrl,
    });

    clientRef.current?.disconnect();
    clientRef.current = new RoomClient({
      signalingUrl,
      roomId,
      peerId,
      nickname: settings.nickname,
      localStream: stream,
      onMembers: (members) => setMembers(members),
      onRoomName: (roomName) => setRoom({ roomName }),
      onConnectionState: (state) => setConnectionState(state),
      onRemoteStream: (remotePeerId, remoteStream) => {
        setRemoteStream(remotePeerId, remoteStream);
      },
    });

    clientRef.current.connect();
    useAppStore.getState().navigate("room");

    speakingRef.current?.destroy();
    speakingRef.current = createSpeakingDetector(stream, (isSpeaking) => {
      clientRef.current?.updateMuteState(useAudioStore.getState().isMuted, isSpeaking);
    });
  };

  const replaceInputDevice = async (preferredInputDeviceId?: string) => {
    if (!clientRef.current || !settings) {
      return;
    }

    speakingRef.current?.destroy();
    const { stream, diagnostics } = await requestMicrophoneStream({
      deviceId: preferredInputDeviceId ?? settings.preferredInputDeviceId,
      noiseSuppression: settings.isNoiseSuppressionEnabled,
    });

    const [nextTrack] = stream.getAudioTracks();
    if (!nextTrack) {
      return;
    }

    setLocalDiagnostics(diagnostics);
    setLocalStream(stream);
    await clientRef.current.replaceInputTrack(nextTrack);

    speakingRef.current = createSpeakingDetector(stream, (isSpeaking) => {
      clientRef.current?.updateMuteState(useAudioStore.getState().isMuted, isSpeaking);
    });
  };

  const leaveRoom = async () => {
    speakingRef.current?.destroy();
    localStream?.getTracks().forEach((track) => track.stop());
    clientRef.current?.disconnect();
    clientRef.current = null;
    await window.desktopApi.host.stop().catch(() => undefined);
    useRoomStore.getState().resetRoom();
    useAppStore.getState().navigate("home");
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
