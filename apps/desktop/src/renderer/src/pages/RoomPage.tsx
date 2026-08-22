import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  RecordingEncoderState,
  RecordingState,
  RoomConnectionState,
  type AppSettings,
  type GameDetectionSnapshot,
  type MemberActivity,
  type ScreenCaptureSourceDescriptor,
  type SceneZoneId,
} from "@private-voice/shared";

import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { RoomDock } from "../components/room/RoomDock";
import { RoomAskDialog } from "../components/room/RoomAskDialog";
import {
  CollectionDialog,
  DonationDialog,
  ScreenSourcePicker,
} from "../components/room/RoomOverlays";
import { ScreenSharePanelContainer } from "../components/room/ScreenSharePanelContainer";
import { TeamIsland } from "../components/room/TeamIsland";
import { RecordingStopDialog } from "../components/status/RecordingStopDialog";
import { playUiSound } from "../features/audio/uiSound";
import { getRemoteAudioMixer } from "../features/audio/RemoteAudioMixer";
import { summarizeConnectionHealth } from "../features/network/networkDiagnostics";
import type { ScreenShareQuality } from "../features/screen-share/types";
import { useScreenShare } from "../features/screen-share/useScreenShare";
import {
  decideAutoAway,
  IDLE_POLL_INTERVAL_MS,
  shouldMuteAfterAwayReturn,
} from "../features/room/autoAway";
import { isSeatZone } from "../features/voice-scene/sceneZones";
import { selectCharacterChatBubbles } from "../features/room/roomViewModel";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useRenderProfiler } from "../features/diagnostics/renderProfiler";
import { useRoomPageSettings } from "../hooks/useRoomPageSettings";
import { useRecordingController } from "../hooks/useRecordingController";
import { useRoomCollection } from "../hooks/useRoomCollection";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { prepareChatImage } from "../utils/chatImage";

const KNOCK_COOLDOWN_MS = 10_000;
interface AwaySession {
  method: "auto" | "manual";
  seat: SceneZoneId;
  activity: MemberActivity;
  gameName?: string;
  gameIconDataUrl?: string;
  musicActivity?: GameDetectionSnapshot["musicActivity"];
  workActivity?: GameDetectionSnapshot["workActivity"];
  enteredAt: string;
}
export const RoomPage = () => {
  const {
    room,
    leaveRoom,
    switchChannel,
    sendChatMessage,
    recallChatMessage,
    sendKnock,
    sendSceneReaction,
    sendQuickMessage,
    replaceInputDevice,
    setMicrophoneSendVolume,
    localStream,
    copyInviteLink,
    moveLocalMember,
    setMemberVolume,
    startScreenShare,
    stopScreenShare,
    addRoomCollectionItem,
    removeRoomCollectionItem,
  } = useRoomState();
  const pushToast = useAppStore((state) => state.pushToast);
  const navigate = useAppStore((state) => state.navigate);
  const setSettingsReturnTo = useAppStore((state) => state.setSettingsReturnTo);
  const setVoiceMemoryOpenTarget = useAppStore((state) => state.setVoiceMemoryOpenTarget);
  const roomAction = useAppStore((state) => state.roomAction);
  const {
    localStream: localScreenShareStream,
    status: screenShareStatus,
    detachedItemId: detachedViewerId,
    openSourcePicker: prepareScreenSourcePicker,
    cancelSourcePicker,
    startShare: startManagedScreenShare,
    stopShare: stopManagedScreenShare,
    shutdown: shutdownScreenShare,
    openDetachedViewer,
    syncDetachedItem,
  } = useScreenShare({
    startPublishing: startScreenShare,
    stopPublishing: stopScreenShare,
    onSourceEnded: () => {
      playUiSound("popup-open");
      pushToast({
        tone: "neutral",
        title: "屏幕分享已停止",
        description: "共享来源已经关闭。",
      });
    },
  });
  const {
    isWorkActivityVisible,
    isAiAutoTranscribeEnabled,
    isAiAutoOrganizeEnabled,
    isAutoRecordOnJoinEnabled,
    isOverlayEnabled,
    isNoiseSuppressionEnabled,
    preferredInputDeviceId,
    recordingSaveDirectory,
    roomDockSettings,
  } = useRoomPageSettings();
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const roomQuickMessages = useRoomStore((state) => state.quickMessages);
  const characterChatBubbles = useMemo(
    () => selectCharacterChatBubbles(chatMessages, roomQuickMessages),
    [chatMessages, roomQuickMessages],
  );
  const remoteScreenSharing = useRoomStore((state) => state.remoteScreenSharing);
  const connectionHealth = useRoomStore((state) => state.connectionHealth);
  const sceneReactions = useRoomStore((state) => state.sceneReactions);
  const channelCounts = useRoomStore((state) => state.channelCounts);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const isMuted = useAudioStore((state) => state.isMuted);
  const isDeafened = useAudioStore((state) => state.isDeafened);
  const toggleMicrophone = useAudioStore((state) => state.toggleMicrophone);
  const toggleDeafen = useAudioStore((state) => state.toggleDeafen);
  const setMuted = useAudioStore((state) => state.setMuted);
  const recordingStatus = useRecordingStore((state) => state.status);
  const recordingMarkers = useRecordingStore((state) => state.markers);
  const addRecordingMarker = useRecordingStore((state) => state.addMarker);
  const clearRecordingMarkers = useRecordingStore((state) => state.clearMarkers);
  const resetRecordingStatus = useRecordingStore((state) => state.resetStatus);
  const { capability, startRecording, stopRecording, discardRecording } = useRecordingController();
  const pageRef = useRef<HTMLDivElement>(null);
  useRenderProfiler("RoomPage", {
    memberCount: room.members.length,
    connectionState: room.connectionState,
    chatCount: chatMessages.length,
    remoteScreenSharing,
    isMuted,
    isDeafened,
    recordingState: recordingStatus.state,
  });
  const [chatInput, setChatInput] = useState("");
  const [pendingIncludeSystemAudio, setPendingIncludeSystemAudio] = useState(false);
  const [isScreenSourcePickerOpen, setIsScreenSourcePickerOpen] = useState(false);
  const [screenSourcePickerSources, setScreenSourcePickerSources] = useState<
    ScreenCaptureSourceDescriptor[]
  >([]);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isNoiseSuppressionSwitching, setIsNoiseSuppressionSwitching] = useState(false);
  const [isAutoGainSwitching, setIsAutoGainSwitching] = useState(false);
  const [isDonationOpen, setIsDonationOpen] = useState(false);
  const [isRoomAskOpen, setIsRoomAskOpen] = useState(false);
  const [localKnockPulse, setLocalKnockPulse] = useState(0);
  const [activeAudioPanel, setActiveAudioPanel] = useState<"microphone" | "speaker">();
  const [isLeaving, setIsLeaving] = useState(false);
  const [recordingStopIntent, setRecordingStopIntent] = useState<"stop" | "leave">();
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [isChoosingRecordingDirectory, setIsChoosingRecordingDirectory] = useState(false);
  const [isSwitchingChannelLocally, setIsSwitchingChannelLocally] = useState(false);
  const lastSeatZoneRef = useRef<SceneZoneId>("gameDesk1");
  const awaySessionRef = useRef<AwaySession | undefined>(undefined);
  const lastKnockAt = useRef(0);
  const detectedGameRef = useRef<string | undefined>(undefined);
  const detectedGameIconRef = useRef<string | undefined>(undefined);
  const detectedMusicRef = useRef<GameDetectionSnapshot["musicActivity"] | undefined>(undefined);
  const detectedWorkRef = useRef<GameDetectionSnapshot["workActivity"] | undefined>(undefined);
  const hasDetectionSnapshotRef = useRef(false);
  const hasAutoStartedRecordingRef = useRef(false);
  const isAutoRecordSuppressedRef = useRef(false);
  const autoRecordRetryCountRef = useRef(0);
  const autoRecordRetryTimerRef = useRef<number | undefined>(undefined);
  const moveLocalMemberRef = useRef(moveLocalMember);
  const screenPickerRequestIdRef = useRef(0);
  const channelSwitchInFlightRef = useRef(false);
  const recordingSpeakingTimelineRef = useRef<
    Array<{ offsetMs: number; memberId: string; nickname: string }>
  >([]);
  moveLocalMemberRef.current = moveLocalMember;
  const reduceMotion = usePrefersReducedMotion();
  const isScreenShareStarting =
    screenShareStatus === "enumerating" ||
    screenShareStatus === "starting" ||
    screenShareStatus === "stopping";
  const canSend =
    room.connectionState === RoomConnectionState.Connected ||
    room.connectionState === RoomConnectionState.WaitingPeer ||
    room.connectionState === RoomConnectionState.WaitingSnapshot;
  const localMember = room.members.find((member) => member.isLocal);
  const visibleMembers = useMemo(
    () =>
      isWorkActivityVisible === false
        ? room.members.map((member) =>
            member.workActivity ? { ...member, workActivity: undefined } : member,
          )
        : room.members,
    [room.members, isWorkActivityVisible],
  );
  const roomCollection = useRoomCollection({
    localMemberId: localMember?.id,
    addItem: addRoomCollectionItem,
  });
  const localMemberId = localMember?.id;
  const localSceneZone = localMember?.sceneZone;
  const localActivity = localMember?.activity;
  const localMusicActivityKey = localMember?.musicActivity
    ? [
        localMember.musicActivity.provider,
        localMember.musicActivity.providerName,
        localMember.musicActivity.trackTitle,
        localMember.musicActivity.artist ?? "",
      ].join("|")
    : "";
  const localWorkActivityKey = localMember?.workActivity
    ? [
        localMember.workActivity.id,
        localMember.workActivity.name,
        localMember.workActivity.category,
        localMember.workActivity.iconDataUrl ?? "",
      ].join("|")
    : "";
  const localGameIconKey = localMember?.gameIconDataUrl ?? "";
  const connectionQuality = summarizeConnectionHealth(connectionHealth);
  const handleSceneReaction = useCallback(
    (targetPeerId: string, emoji: Parameters<typeof sendSceneReaction>[1]) => {
      void sendSceneReaction(targetPeerId, emoji);
    },
    [sendSceneReaction],
  );
  const handleMemberVolumeChange = useCallback(
    (memberId: string, volume: number) => setMemberVolume(memberId, volume),
    [setMemberVolume],
  );
  useEffect(() => {
    if (recordingStatus.state !== RecordingState.Recording || !recordingStatus.startedAt) return;
    const now = Date.now();
    for (const member of room.members) {
      if (member.speakingState !== "speaking") continue;
      const offsetMs = Math.max(0, now - recordingStatus.startedAt);
      const previous = recordingSpeakingTimelineRef.current.at(-1);
      if (previous?.memberId === member.id && offsetMs - previous.offsetMs < 240) continue;
      recordingSpeakingTimelineRef.current.push({
        offsetMs,
        memberId: member.id,
        nickname: member.nickname,
      });
    }
  }, [recordingStatus.startedAt, recordingStatus.state, room.members]);

  const queueVoiceMemory = (
    result: { filePath: string; recordingId?: string },
    markers = recordingMarkers,
  ) => {
    if (!isAiAutoTranscribeEnabled || !window.desktopApi.ai?.processRecording) return;
    const request = {
      recordingId: result.recordingId ?? result.filePath,
      filePath: result.filePath,
      roomId: room.roomId,
      roomName: room.roomName,
      manual: false,
      organize: isAiAutoOrganizeEnabled,
      markers: markers.map((marker) => ({ id: marker.id, offsetMs: marker.offsetMs })),
      speakingTimeline: recordingSpeakingTimelineRef.current,
    };
    recordingSpeakingTimelineRef.current = [];
    void window.desktopApi.ai.processRecording(request).catch((error) =>
      window.desktopApi.app.writeLog({
        category: "app",
        level: "warn",
        message: "voice_memory_auto_process_deferred",
        context: { error: error instanceof Error ? error.message : String(error) },
      }),
    );
  };
  const finishSavedRecording = async (
    result: { filePath: string; recordingId?: string },
    markers = recordingMarkers,
  ) => {
    if (markers.length) {
      await window.desktopApi.recording.saveMarkers(result.filePath, markers);
    }
    let deletedCurrentRecording = false;
    try {
      const cleanup = await window.desktopApi.recording.applyAutomaticCleanup(result.filePath);
      deletedCurrentRecording = cleanup.deletedCurrentRecording;
    } catch (error) {
      void window.desktopApi.app.writeLog({
        category: "app",
        level: "warn",
        message: "recording_automatic_cleanup_deferred",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
    }
    if (deletedCurrentRecording) {
      recordingSpeakingTimelineRef.current = [];
      pushToast({
        tone: "neutral",
        title: "短录音已自动清理",
        description: "这条录音不足五分钟，且没有收藏或标记。",
      });
      return;
    }
    queueVoiceMemory(result, markers);
  };
  const screenSharingPeerIds = useMemo(
    () =>
      [
        ...(localScreenShareStream && localMember ? [localMember.id] : []),
        ...Object.keys(remoteScreenSharing),
      ].filter((peerId, index, peers) => peers.indexOf(peerId) === index),
    [localMember, localScreenShareStream, remoteScreenSharing],
  );

  useEffect(() => {
    const publishPressure = () => {
      const memory = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        }
      ).memory;
      void window.desktopApi.ai?.updateRuntimePressure?.({
        inVoiceRoom: room.connectionState === RoomConnectionState.Connected,
        screenSharing: Boolean(localScreenShareStream || screenSharingPeerIds.length),
        peerRecovering: connectionHealth.reconnectAttempt > 0,
        latencyMs: connectionHealth.latencyMs,
        packetLossPercent: connectionHealth.packetLossPercent,
        rendererMemoryPressure: Boolean(
          memory && memory.usedJSHeapSize / Math.max(1, memory.jsHeapSizeLimit) > 0.82,
        ),
        updatedAt: Date.now(),
      });
    };
    publishPressure();
    const interval = window.setInterval(publishPressure, 3_000);
    return () => window.clearInterval(interval);
  }, [
    connectionHealth.latencyMs,
    connectionHealth.packetLossPercent,
    connectionHealth.reconnectAttempt,
    localScreenShareStream,
    room.connectionState,
    screenSharingPeerIds.length,
  ]);

  useEffect(() => {
    const overlayState = {
      members: room.members,
      isMuted,
      isDeafened,
      connectionState: room.connectionState,
      isRecording: recordingStatus.state === RecordingState.Recording,
      isScreenSharing: Boolean(localScreenShareStream),
      hasSystemAudio: Boolean(
        localScreenShareStream?.getAudioTracks().some((track) => track.readyState === "live"),
      ),
    };
    void window.desktopApi.overlay.update(overlayState);
    const heartbeat = window.setInterval(() => {
      void window.desktopApi.overlay.update({
        ...overlayState,
        members: useRoomStore.getState().room.members,
      });
    }, 2_000);
    return () => window.clearInterval(heartbeat);
  }, [
    isDeafened,
    isMuted,
    localScreenShareStream,
    recordingStatus.state,
    room.connectionState,
    room.members,
  ]);

  useEffect(() => {
    if (!activeAudioPanel) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-audio-control-root]")) return;
      setActiveAudioPanel(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveAudioPanel(undefined);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeAudioPanel]);

  useEffect(() => {
    hasAutoStartedRecordingRef.current = false;
    isAutoRecordSuppressedRef.current = false;
    autoRecordRetryCountRef.current = 0;
    if (autoRecordRetryTimerRef.current !== undefined) {
      window.clearTimeout(autoRecordRetryTimerRef.current);
      autoRecordRetryTimerRef.current = undefined;
    }
  }, [room.roomId]);

  useEffect(() => {
    const hasLiveMicrophone = localStream
      ?.getAudioTracks()
      .some((track) => track.readyState === "live");
    const canAutoRecord =
      isAutoRecordOnJoinEnabled &&
      canSend &&
      hasLiveMicrophone &&
      recordingStatus.state === RecordingState.Idle &&
      capability.encoderState !== RecordingEncoderState.Unsupported;

    if (!canAutoRecord || hasAutoStartedRecordingRef.current || isAutoRecordSuppressedRef.current)
      return;

    const attemptAutoRecord = () => {
      if (isAutoRecordSuppressedRef.current) {
        autoRecordRetryTimerRef.current = undefined;
        return;
      }
      hasAutoStartedRecordingRef.current = true;
      try {
        clearRecordingMarkers();
        const status = startRecording();
        if (status.state !== RecordingState.Recording) {
          throw new Error(status.message || "recording_start_failed");
        }
        autoRecordRetryCountRef.current = 0;
        autoRecordRetryTimerRef.current = undefined;
        playUiSound("record-start");
        pushToast({
          tone: "neutral",
          title: "已自动开始录音",
          description: "退出频道时会直接保存到录音库。",
        });
        void window.desktopApi.app.writeLog({
          category: "recording",
          level: "info",
          message: "auto_record_started",
        });
      } catch (error) {
        hasAutoStartedRecordingRef.current = false;
        autoRecordRetryCountRef.current += 1;
        const retryCount = autoRecordRetryCountRef.current;
        void window.desktopApi.app.writeLog({
          category: "recording",
          level: retryCount >= 5 ? "error" : "warn",
          message: retryCount >= 5 ? "auto_record_start_failed" : "auto_record_start_retry",
          context: {
            retryCount,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        if (retryCount < 5) {
          autoRecordRetryTimerRef.current = window.setTimeout(
            attemptAutoRecord,
            600 + retryCount * 250,
          );
        }
      }
    };

    autoRecordRetryTimerRef.current = window.setTimeout(attemptAutoRecord, 450);
    return () => {
      if (autoRecordRetryTimerRef.current !== undefined) {
        window.clearTimeout(autoRecordRetryTimerRef.current);
        autoRecordRetryTimerRef.current = undefined;
      }
    };
  }, [
    canSend,
    capability.encoderState,
    clearRecordingMarkers,
    localStream,
    pushToast,
    recordingStatus.state,
    isAutoRecordOnJoinEnabled,
    startRecording,
  ]);

  useEffect(() => {
    if (isOverlayEnabled === false) {
      void window.desktopApi.overlay.close().then(() => setIsOverlayOpen(false));
      return;
    }
    void window.desktopApi.overlay.show().then(setIsOverlayOpen);
  }, [isOverlayEnabled]);

  useEffect(
    () =>
      window.desktopApi.shortcuts.onRecordingMarkerTriggered(() => {
        if (useRecordingStore.getState().status.state !== RecordingState.Recording) {
          return;
        }
        const startedAt = useRecordingStore.getState().status.startedAt ?? Date.now();
        addRecordingMarker({
          id: crypto.randomUUID(),
          offsetMs: Math.max(0, Date.now() - startedAt),
          createdAt: new Date().toISOString(),
        });
        playUiSound("button-click");
        pushToast({
          tone: "neutral",
          title: "已标记精彩时刻",
          description: "停止录音后会在录音旁保存时间点。",
        });
      }),
    [addRecordingMarker, pushToast],
  );

  useEffect(() => {
    if (localSceneZone && isSeatZone(localSceneZone)) {
      lastSeatZoneRef.current = localSceneZone;
    }
  }, [localSceneZone]);

  useEffect(() => {
    let disposed = false;
    const checkIdleState = async () => {
      const idleSeconds = await window.desktopApi.app.getSystemIdleSeconds().catch(() => 0);
      if (disposed) return;
      const currentLocalMember = useRoomStore
        .getState()
        .room.members.find((member) => member.isLocal);
      if (!currentLocalMember) return;
      const currentConnectionState = useRoomStore.getState().room.connectionState;
      const isConnectionValid =
        currentConnectionState === RoomConnectionState.Connected ||
        currentConnectionState === RoomConnectionState.WaitingPeer ||
        currentConnectionState === RoomConnectionState.WaitingSnapshot;

      const decision = decideAutoAway({
        idleSeconds,
        isInAwayZone: currentLocalMember.sceneZone === "restroomZone",
        awayMethod: awaySessionRef.current?.method,
        isConnectionValid,
      });

      if (decision === "auto_away") {
        const currentZone = currentLocalMember.sceneZone ?? lastSeatZoneRef.current;
        const seat = isSeatZone(currentZone) ? currentZone : lastSeatZoneRef.current;
        awaySessionRef.current = {
          method: "auto",
          seat,
          activity: currentLocalMember.activity ?? "idle",
          gameName: currentLocalMember.gameName,
          gameIconDataUrl: currentLocalMember.gameIconDataUrl,
          musicActivity: currentLocalMember.musicActivity,
          workActivity: currentLocalMember.workActivity,
          enteredAt: new Date().toISOString(),
        };
        setMuted(true);
        moveLocalMemberRef.current(
          "restroomZone",
          "restroom",
          currentLocalMember.gameName,
          currentLocalMember.musicActivity,
          currentLocalMember.gameIconDataUrl,
          currentLocalMember.workActivity,
        );
        void window.desktopApi.app.writeLog({
          category: "app",
          level: "info",
          message: "auto_away",
          context: { idleSeconds, seat, gameName: currentLocalMember.gameName },
        });
        pushToast({
          tone: "neutral",
          title: "30 分钟没有操作，已切到离开。",
          description: "重新操作电脑后会自动回到原来的位置。",
        });
        return;
      }

      const awaySession = awaySessionRef.current;
      if (decision === "auto_return" && awaySession?.method === "auto") {
        awaySessionRef.current = undefined;
        const shouldRemainMuted = shouldMuteAfterAwayReturn({
          isDeafened: useAudioStore.getState().isDeafened,
        });
        setMuted(shouldRemainMuted);
        moveLocalMemberRef.current(
          awaySession.seat,
          awaySession.gameName ? "gaming" : awaySession.activity,
          awaySession.gameName,
          awaySession.musicActivity,
          awaySession.gameIconDataUrl,
          awaySession.workActivity,
        );
        void window.desktopApi.app.writeLog({
          category: "app",
          level: "info",
          message: "auto_return",
          context: { seat: awaySession.seat, awaySince: awaySession.enteredAt },
        });
        pushToast({
          tone: "success",
          title: "欢迎回来，已回到原来的位置。",
          description: shouldRemainMuted ? "扬声器仍关闭，麦克风保持静音。" : "麦克风已自动恢复。",
        });
      }
    };

    void checkIdleState();
    const timer = window.setInterval(() => void checkIdleState(), IDLE_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [pushToast, setMuted]);

  useEffect(() => {
    const applyGameDetection = (snapshot: GameDetectionSnapshot) => {
      hasDetectionSnapshotRef.current = true;
      const previousGame = detectedGameRef.current;
      detectedGameRef.current = snapshot.gameName;
      detectedGameIconRef.current = snapshot.gameIconDataUrl;
      detectedMusicRef.current = snapshot.musicActivity;
      const workActivity = useSettingsStore.getState().settings?.isWorkActivityVisible
        ? snapshot.workActivity
        : undefined;
      detectedWorkRef.current = workActivity;
      const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
      const currentZone = localMember?.sceneZone ?? "gameDesk1";

      if (snapshot.gameName) {
        if (currentZone === "restroomZone") {
          moveLocalMemberRef.current(
            "restroomZone",
            "restroom",
            snapshot.gameName,
            snapshot.musicActivity,
            snapshot.gameIconDataUrl,
            workActivity,
          );
        } else {
          const gameZone = currentZone.startsWith("gameDesk") ? currentZone : "gameDesk1";
          moveLocalMemberRef.current(
            gameZone,
            "gaming",
            snapshot.gameName,
            snapshot.musicActivity,
            snapshot.gameIconDataUrl,
            workActivity,
          );
        }
      } else if (previousGame) {
        moveLocalMemberRef.current(
          currentZone,
          currentZone === "restroomZone" ? "restroom" : "idle",
          undefined,
          snapshot.musicActivity,
          undefined,
          workActivity,
        );
      } else {
        moveLocalMemberRef.current(
          currentZone,
          currentZone === "restroomZone" ? "restroom" : (localMember?.activity ?? "idle"),
          undefined,
          snapshot.musicActivity,
          undefined,
          workActivity,
        );
      }
    };

    void window.desktopApi.games.getSnapshot().then(applyGameDetection);
    return window.desktopApi.games.onDetected(applyGameDetection);
  }, []);

  useEffect(() => {
    if (!hasDetectionSnapshotRef.current) return;
    void window.desktopApi.games.getSnapshot().then((snapshot) => {
      const workActivity = isWorkActivityVisible ? snapshot.workActivity : undefined;
      detectedWorkRef.current = workActivity;
      const currentLocalMember = useRoomStore
        .getState()
        .room.members.find((member) => member.isLocal);
      if (!currentLocalMember) return;
      const sceneZone = currentLocalMember.sceneZone ?? "gameDesk1";
      moveLocalMemberRef.current(
        sceneZone,
        sceneZone === "restroomZone"
          ? "restroom"
          : snapshot.gameName
            ? "gaming"
            : (currentLocalMember.activity ?? "idle"),
        snapshot.gameName,
        snapshot.musicActivity,
        snapshot.gameIconDataUrl,
        workActivity,
      );
    });
  }, [isWorkActivityVisible]);

  useEffect(() => {
    if (!hasDetectionSnapshotRef.current || !localMemberId) return;

    const detectedMusicActivityKey = JSON.stringify(detectedMusicRef.current ?? null);
    const detectedWorkActivityKey = JSON.stringify(detectedWorkRef.current ?? null);
    const detectedGameIconKey = detectedGameIconRef.current ?? "";
    if (
      detectedMusicActivityKey === localMusicActivityKey &&
      detectedWorkActivityKey === localWorkActivityKey &&
      detectedGameIconKey === localGameIconKey
    )
      return;

    const sceneZone = localSceneZone ?? "gameDesk1";
    moveLocalMemberRef.current(
      sceneZone,
      sceneZone === "restroomZone"
        ? "restroom"
        : detectedGameRef.current
          ? "gaming"
          : (localActivity ?? "idle"),
      detectedGameRef.current,
      detectedMusicRef.current,
      detectedGameIconRef.current,
      detectedWorkRef.current,
    );
  }, [
    localGameIconKey,
    localActivity,
    localMemberId,
    localSceneZone,
    localMusicActivityKey,
    localWorkActivityKey,
  ]);

  const send = async (content = chatInput) => {
    if (!content.trim()) return;
    const isComposerMessage = content === chatInput;
    if (isComposerMessage) setChatInput("");
    try {
      await sendChatMessage(content);
      playUiSound("send-message");
    } catch {
      // sendChatMessage already exposes a user-facing retry state.
    }
  };

  const sendImage = async (file: File) => {
    if (!canSend) return;
    try {
      const image = await prepareChatImage(file);
      await sendChatMessage("", image);
      playUiSound("send-message");
    } catch (error) {
      pushToast({
        tone: "warning",
        title: "图片没有发出去",
        description: error instanceof Error ? error.message : "请换一张图片重试。",
      });
    }
  };

  const knock = async () => {
    const remaining = KNOCK_COOLDOWN_MS - (Date.now() - lastKnockAt.current);
    if (remaining > 0) {
      pushToast({
        tone: "neutral",
        title: "刚刚已经敲过啦",
        description: `${Math.ceil(remaining / 1000)} 秒后可以再敲一次。`,
      });
      return;
    }
    lastKnockAt.current = Date.now();
    setLocalKnockPulse((current) => current + 1);
    await sendKnock();
  };

  const toggleRecording = async () => {
    try {
      if (recordingStatus.state === RecordingState.Recording) {
        setRecordingStopIntent("stop");
        playUiSound("popup-open");
        return;
      }

      clearRecordingMarkers();
      const status = startRecording();
      if (status.state !== RecordingState.Recording) {
        throw new Error(status.message || "recording_start_failed");
      }
      isAutoRecordSuppressedRef.current = true;
      hasAutoStartedRecordingRef.current = true;
      autoRecordRetryCountRef.current = 0;
      if (autoRecordRetryTimerRef.current !== undefined) {
        window.clearTimeout(autoRecordRetryTimerRef.current);
        autoRecordRetryTimerRef.current = undefined;
      }
      playUiSound("record-start");
    } catch {
      pushToast({ tone: "danger", title: "录音失败", description: "请稍后再试。" });
    }
  };

  const closeScreenSourcePicker = (cancelManager = true) => {
    screenPickerRequestIdRef.current += 1;
    setIsScreenSourcePickerOpen(false);
    setScreenSourcePickerSources([]);
    if (cancelManager) void cancelSourcePicker();
  };

  const performLeave = async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    closeScreenSourcePicker();

    void Promise.allSettled([shutdownScreenShare(), window.desktopApi.overlay.close()]).then(
      (cleanupResults) => {
        const cleanupErrors = cleanupResults
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) =>
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
        if (cleanupErrors.length) {
          void window.desktopApi.app
            .writeLog({
              category: "app",
              level: "warn",
              message: "room_leave_background_cleanup_failed",
              context: { errors: cleanupErrors },
            })
            .catch(() => undefined);
        }
      },
    );

    try {
      await leaveRoom();
    } catch (error) {
      setIsLeaving(false);
      pushToast({
        tone: "danger",
        title: "暂时无法退出",
        description: "房间连接还没有完全断开，请再试一次。",
      });
      void window.desktopApi.app
        .writeLog({
          category: "app",
          level: "error",
          message: "room_leave_failed",
          context: { error: error instanceof Error ? error.message : String(error) },
        })
        .catch(() => undefined);
    }
  };

  const leave = async () => {
    if (isLeaving) return;
    if (recordingStatus.state === RecordingState.Recording) {
      if (isAutoRecordOnJoinEnabled) {
        setIsFinalizingRecording(true);
        try {
          const result = await stopRecording();
          await finishSavedRecording(result, recordingMarkers);
          clearRecordingMarkers();
          resetRecordingStatus();
          playUiSound("record-stop");
          await performLeave();
        } catch (error) {
          pushToast({
            tone: "danger",
            title: "录音保存失败",
            description: error instanceof Error ? error.message : "请稍后再试。",
          });
        } finally {
          setIsFinalizingRecording(false);
        }
        return;
      }
      setRecordingStopIntent("leave");
      playUiSound("popup-open");
      return;
    }
    await performLeave();
  };

  const finalizeRecording = async (shouldSave: boolean) => {
    if (!recordingStopIntent || isFinalizingRecording) return;
    const intent = recordingStopIntent;
    if (intent === "stop") {
      isAutoRecordSuppressedRef.current = true;
      hasAutoStartedRecordingRef.current = true;
      autoRecordRetryCountRef.current = 0;
      if (autoRecordRetryTimerRef.current !== undefined) {
        window.clearTimeout(autoRecordRetryTimerRef.current);
        autoRecordRetryTimerRef.current = undefined;
      }
    }
    setIsFinalizingRecording(true);
    try {
      if (shouldSave) {
        const result = await stopRecording();
        await finishSavedRecording(result, recordingMarkers);
      } else {
        await discardRecording();
      }
      clearRecordingMarkers();
      setRecordingStopIntent(undefined);
      playUiSound("record-stop");
      if (intent === "leave") await performLeave();
    } catch (error) {
      pushToast({
        tone: "danger",
        title: shouldSave ? "录音保存失败" : "录音结束失败",
        description: error instanceof Error ? error.message : "请稍后再试。",
      });
    } finally {
      setIsFinalizingRecording(false);
    }
  };

  const changeRecordingDirectory = async () => {
    if (isChoosingRecordingDirectory || isFinalizingRecording) return;
    setIsChoosingRecordingDirectory(true);
    try {
      const directory = await window.desktopApi.recording.chooseDirectory();
      if (!directory) return;
      await saveSettings({ recordingSaveDirectory: directory });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "无法更改保存位置",
        description: error instanceof Error ? error.message : "请稍后再试。",
      });
    } finally {
      setIsChoosingRecordingDirectory(false);
    }
  };

  const startSharingScreen = async (sourceId: string, quality: ScreenShareQuality) => {
    try {
      closeScreenSourcePicker(false);
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      const stream = await startManagedScreenShare({
        sourceId,
        includeSystemAudio: pendingIncludeSystemAudio,
        quality,
      });
      playUiSound("popup-open");
      pushToast({
        tone: "success",
        title: "屏幕分享已开启",
        description: stream.getAudioTracks().length
          ? "好友现在可以看到画面并听到系统声音。"
          : "好友现在可以看到画面；本次未捕获到系统声音。",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        pushToast({
          tone: "neutral",
          title: "已取消屏幕分享",
          description: "没有选择要分享的窗口。",
        });
        return;
      }

      pushToast({
        tone: "danger",
        title: "屏幕分享失败",
        description:
          error instanceof DOMException && error.name === "NotFoundError"
            ? "没有找到可分享的显示器或窗口。"
            : "桌面捕获没有启动，请重试；错误详情已经写入诊断日志。",
      });
    }
  };

  const openScreenSourcePicker = async () => {
    const requestId = ++screenPickerRequestIdRef.current;
    try {
      const sources = await prepareScreenSourcePicker();
      if (requestId !== screenPickerRequestIdRef.current) return;
      if (!sources.length) {
        pushToast({
          tone: "danger",
          title: "没有找到可分享的画面",
          description: "请确认 Windows 允许上号进行屏幕捕获后重试。",
        });
        return;
      }
      setScreenSourcePickerSources(sources);
      setPendingIncludeSystemAudio(false);
      setIsScreenSourcePickerOpen(true);
    } catch {
      if (requestId !== screenPickerRequestIdRef.current) return;
      pushToast({
        tone: "danger",
        title: "没有找到可分享的画面",
        description: "请确认 Windows 允许上号进行屏幕捕获后重试。",
      });
    }
  };

  const handleSwitchChannel = async (channelId: "main" | "side") => {
    const currentChannelId = room.roomId === "side" ? "side" : "main";
    if (channelSwitchInFlightRef.current || currentChannelId === channelId) return;

    channelSwitchInFlightRef.current = true;
    setIsSwitchingChannelLocally(true);
    closeScreenSourcePicker();
    try {
      await shutdownScreenShare().catch((error: unknown) => {
        void window.desktopApi.app
          .writeLog({
            category: "webrtc",
            level: "warn",
            message: "channel_switch_screen_share_cleanup_failed",
            context: { error: error instanceof Error ? error.message : String(error) },
          })
          .catch(() => undefined);
      });
      await switchChannel(channelId);
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "暂时无法切换房间",
        description: "当前连接还在收尾，请稍后再试。",
      });
      void window.desktopApi.app
        .writeLog({
          category: "signaling",
          level: "error",
          message: "channel_switch_failed",
          context: {
            channelId,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => undefined);
    } finally {
      channelSwitchInFlightRef.current = false;
      setIsSwitchingChannelLocally(false);
    }
  };

  const stopSharingScreen = async () => {
    await stopManagedScreenShare("user");
    playUiSound("popup-open");
    pushToast({
      tone: "neutral",
      title: "屏幕分享已停止",
      description: "好友不再看到你的屏幕。",
    });
  };

  const switchInputDevice = async (preferredInputDeviceId?: string) => {
    await saveSettings({ preferredInputDeviceId });
    await replaceInputDevice(preferredInputDeviceId);
    playUiSound("device-switch");
    pushToast({ tone: "success", title: "麦克风已切换", description: "新的输入设备已经生效。" });
  };

  const toggleNoiseSuppression = async () => {
    if (isNoiseSuppressionEnabled === undefined || isNoiseSuppressionSwitching) return;
    const nextNoiseSuppressionEnabled = !isNoiseSuppressionEnabled;
    setIsNoiseSuppressionSwitching(true);
    try {
      await saveSettings({ isNoiseSuppressionEnabled: nextNoiseSuppressionEnabled });
      await replaceInputDevice(preferredInputDeviceId);
      playUiSound("button-click");
      pushToast({
        tone: nextNoiseSuppressionEnabled ? "success" : "neutral",
        title: nextNoiseSuppressionEnabled ? "降噪已开启" : "降噪已关闭",
        description: nextNoiseSuppressionEnabled
          ? "DeepFilterNet 正在本机实时处理麦克风。"
          : "现在发送麦克风原声。",
      });
      await window.desktopApi.app.writeLog({
        category: "audio",
        level: "info",
        message: "deepfilter_user_toggle",
        context: { enabled: nextNoiseSuppressionEnabled },
      });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "降噪切换失败",
        description: "麦克风仍保持可用，请稍后重试。",
      });
      await window.desktopApi.app.writeLog({
        category: "audio",
        level: "error",
        message: "deepfilter_user_toggle_failed",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setIsNoiseSuppressionSwitching(false);
    }
  };

  const updateMicrophoneProcessing = async (
    patch: Partial<Pick<AppSettings, "isEchoCancellationEnabled" | "isVoiceEnhancementEnabled">>,
    enabledTitle: string,
    disabledTitle: string,
  ) => {
    if (isNoiseSuppressionEnabled === undefined || isNoiseSuppressionSwitching) return;
    setIsNoiseSuppressionSwitching(true);
    try {
      await saveSettings(patch);
      await replaceInputDevice(preferredInputDeviceId);
      const enabled = Object.values(patch)[0] === true;
      playUiSound("button-click");
      pushToast({
        tone: enabled ? "success" : "neutral",
        title: enabled ? enabledTitle : disabledTitle,
      });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "麦克风设置切换失败",
        description: "麦克风仍保持可用，请稍后重试。",
      });
      await window.desktopApi.app.writeLog({
        category: "audio",
        level: "error",
        message: "microphone_processing_user_toggle_failed",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setIsNoiseSuppressionSwitching(false);
    }
  };

  const toggleAutoGain = async (isAutoGainControlEnabled: boolean) => {
    if (isAutoGainSwitching) return;
    setIsAutoGainSwitching(true);
    try {
      await saveSettings({ isAutoGainControlEnabled });
      await replaceInputDevice(preferredInputDeviceId);
      playUiSound("button-click");
      pushToast({
        tone: isAutoGainControlEnabled ? "success" : "neutral",
        title: isAutoGainControlEnabled ? "自动增益已开启" : "自动增益已关闭",
        description: "麦克风已经按新设置重新连接。",
      });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "自动增益切换失败",
        description: "麦克风仍保持可用，请稍后重试。",
      });
      await window.desktopApi.app.writeLog({
        category: "audio",
        level: "error",
        message: "auto_gain_user_toggle_failed",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      setIsAutoGainSwitching(false);
    }
  };

  const switchOutputDevice = async (preferredOutputDeviceId?: string) => {
    try {
      await getRemoteAudioMixer().setOutputDevice(preferredOutputDeviceId);
      await saveSettings({ preferredOutputDeviceId });
      playUiSound("device-switch");
      pushToast({
        tone: "success",
        title: "扬声器已切换",
        description: "新的输出设备已经生效。",
      });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "扬声器切换失败",
        description: "请确认设备仍然连接后重试。",
      });
      await window.desktopApi.app.writeLog({
        category: "audio",
        level: "error",
        message: "output_device_switch_failed",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  const handleZoneSelect = (zone: SceneZoneId, activity: MemberActivity) => {
    if (isSeatZone(zone)) {
      lastSeatZoneRef.current = zone;
      const awaySession = awaySessionRef.current;
      const wasAway = Boolean(awaySession || localMember?.sceneZone === "restroomZone");
      awaySessionRef.current = undefined;
      if (wasAway) {
        setMuted(shouldMuteAfterAwayReturn({ isDeafened }));
      }
      if (wasAway) {
        void window.desktopApi.app.writeLog({
          category: "app",
          level: "info",
          message: "manual_return",
          context: { seat: zone },
        });
      }
    } else if (zone === "restroomZone") {
      awaySessionRef.current = {
        method: "manual",
        seat: lastSeatZoneRef.current,
        activity: localMember?.activity ?? "idle",
        gameName: localMember?.gameName,
        gameIconDataUrl: localMember?.gameIconDataUrl,
        musicActivity: localMember?.musicActivity,
        workActivity: localMember?.workActivity,
        enteredAt: new Date().toISOString(),
      };
      setMuted(true);
      void window.desktopApi.app.writeLog({
        category: "app",
        level: "info",
        message: "manual_away",
        context: { seat: lastSeatZoneRef.current },
      });
    }
    moveLocalMember(
      zone,
      activity,
      detectedGameRef.current,
      detectedMusicRef.current ?? localMember?.musicActivity,
      detectedGameIconRef.current ?? localMember?.gameIconDataUrl,
      detectedWorkRef.current ?? localMember?.workActivity,
    );
  };

  const handleToggleMicrophone = () => {
    if (isDeafened && isMuted) {
      pushToast({
        tone: "warning",
        title: "先打开扬声器后才能开麦。",
        description: "关闭扬声器时会同时关闭麦克风。",
      });
      return;
    }
    toggleMicrophone();
  };

  return (
    <div
      ref={pageRef}
      className={`room-page relative flex h-full flex-col gap-2.5 overflow-hidden px-3.5 pb-3.5 pt-2 ${
        localMember?.gameName ? "performance-gaming" : ""
      }`}
    >
      <div>
        <TopStatusBar
          currentChannelId={room.roomId === "side" ? "side" : "main"}
          channelCounts={channelCounts}
          isSwitchingChannel={isSwitchingChannelLocally || roomAction === "joining"}
          onSwitchChannel={(channelId) => void handleSwitchChannel(channelId)}
          onDonate={() => setIsDonationOpen(true)}
          onKnock={() => void knock()}
          onInvite={() => void copyInviteLink()}
          onAsk={() => setIsRoomAskOpen((isOpen) => !isOpen)}
        />
      </div>

      <main className="room-main-grid grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[minmax(0,1.44fr)_minmax(280px,.56fr)]">
        <section className="room-scene-column island-panel min-h-0 overflow-hidden">
          <TeamIsland
            members={visibleMembers}
            onZoneSelect={handleZoneSelect}
            onReact={handleSceneReaction}
            onVolumeChange={handleMemberVolumeChange}
            screenSharingPeerIds={screenSharingPeerIds}
            networkQuality={connectionQuality.level}
            reactions={sceneReactions}
            chatBubbles={characterChatBubbles}
            collectionItems={roomCollection.items}
            isCollectionOpen={roomCollection.isOpen}
            isCollectionDragOver={roomCollection.isDragOver}
            hasUnreadCollectionItems={roomCollection.hasUnreadItems}
            onOpenCollection={roomCollection.open}
            onCollectionDragOverChange={roomCollection.setIsDragOver}
            onSaveDraggedCollection={(payload) => void roomCollection.saveDragged(payload)}
            pauseVisualMotion
            knockPulse={
              localKnockPulse +
              chatMessages.filter((message) => message.id.startsWith("knock-")).length
            }
            reduceMotion={reduceMotion}
          />
          <ScreenSharePanelContainer
            localStream={localScreenShareStream}
            detachedItemId={detachedViewerId}
            onStopLocalShare={() => void stopSharingScreen()}
            onOpenDetached={async (item) => {
              try {
                await openDetachedViewer({
                  ...item,
                  title: `上号 · ${item.title}`,
                });
              } catch {
                pushToast({
                  tone: "danger",
                  title: "无法打开独立观看窗口",
                  description: "共享仍在继续，可以稍后重试。",
                });
              }
            }}
            syncDetachedItem={syncDetachedItem}
          />
        </section>
        <div className="room-chat-column min-h-0">
          <TemporaryChatPanel
            className="h-full"
            messages={chatMessages}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onSend={() => void send()}
            onQuickSend={(message) => {
              void sendQuickMessage(message).catch(() => {
                pushToast({
                  tone: "warning",
                  title: "提醒没有发出去",
                  description: "连接恢复后再试一次。",
                });
              });
            }}
            onSendImage={sendImage}
            onRecall={async (messageId) => {
              try {
                await recallChatMessage(messageId);
              } catch {
                pushToast({
                  tone: "danger",
                  title: "撤回失败",
                  description: "连接恢复后再试一次。",
                });
              }
            }}
            onRetry={async (message) => {
              if (!message.clientMessageId) return;
              await sendChatMessage(message.content, message.image, message.clientMessageId);
            }}
            canSend={canSend}
            unavailableLabel="正在重连..."
            reduceMotion={reduceMotion}
          />
        </div>
      </main>

      <ScreenSourcePicker
        isOpen={isScreenSourcePickerOpen}
        reduceMotion={reduceMotion}
        sources={screenSourcePickerSources}
        includeSystemAudio={pendingIncludeSystemAudio}
        onIncludeSystemAudioChange={setPendingIncludeSystemAudio}
        onSelect={(sourceId, quality) => void startSharingScreen(sourceId, quality)}
        onClose={() => closeScreenSourcePicker()}
      />

      <DonationDialog
        isOpen={isDonationOpen}
        reduceMotion={reduceMotion}
        onClose={() => setIsDonationOpen(false)}
      />
      <RoomAskDialog
        isOpen={isRoomAskOpen}
        reduceMotion={reduceMotion}
        onClose={() => setIsRoomAskOpen(false)}
        onOpenResult={(target) => {
          setIsRoomAskOpen(false);
          setVoiceMemoryOpenTarget(target);
          setSettingsReturnTo("room");
          navigate("settings");
        }}
      />
      <CollectionDialog
        isOpen={roomCollection.isOpen}
        reduceMotion={reduceMotion}
        draft={roomCollection.draft}
        isSaving={roomCollection.isSaving}
        items={roomCollection.items}
        onDraftChange={roomCollection.setDraft}
        onSave={() => void roomCollection.saveDraft()}
        onOpenItem={(content) => void roomCollection.openItem(content)}
        onCopyItem={(content, kind) => void roomCollection.copyItem(content, kind)}
        onRemoveItem={(itemId) => void removeRoomCollectionItem(itemId)}
        onClose={() => roomCollection.setIsOpen(false)}
      />

      <RecordingStopDialog
        isOpen={Boolean(recordingStopIntent)}
        isWorking={isFinalizingRecording}
        isChoosingDirectory={isChoosingRecordingDirectory}
        saveDirectory={recordingSaveDirectory ?? "文档 / 上号录音"}
        onChangeDirectory={() => void changeRecordingDirectory()}
        onContinue={() => setRecordingStopIntent(undefined)}
        onDiscard={() => void finalizeRecording(false)}
        onSave={() => void finalizeRecording(true)}
      />

      <RoomDock
        activeAudioPanel={activeAudioPanel}
        setActiveAudioPanel={setActiveAudioPanel}
        settings={roomDockSettings}
        inputDevices={inputDevices}
        outputDevices={outputDevices}
        isMuted={isMuted}
        isDeafened={isDeafened}
        isNoiseSuppressionSwitching={isNoiseSuppressionSwitching}
        recordingState={recordingStatus.state}
        recordingEncoderState={capability.encoderState}
        localScreenShareActive={Boolean(localScreenShareStream)}
        isScreenShareStarting={isScreenShareStarting}
        isOverlayOpen={isOverlayOpen}
        isLeaving={isLeaving}
        onToggleMicrophone={handleToggleMicrophone}
        onToggleDeafen={toggleDeafen}
        onSwitchInputDevice={(deviceId) => void switchInputDevice(deviceId)}
        onMicrophoneVolumePreview={setMicrophoneSendVolume}
        onMicrophoneVolumeCommit={(microphoneSendVolume) =>
          void saveSettings({ microphoneSendVolume })
        }
        onNoiseSuppressionChange={() => void toggleNoiseSuppression()}
        onEchoCancellationChange={(isEchoCancellationEnabled) =>
          void updateMicrophoneProcessing(
            { isEchoCancellationEnabled },
            "回声消除已开启",
            "回声消除已关闭",
          )
        }
        onVoiceEnhancementChange={(isVoiceEnhancementEnabled) =>
          void updateMicrophoneProcessing(
            { isVoiceEnhancementEnabled },
            "自然人声已开启",
            "自然人声已关闭",
          )
        }
        onAutoGainChange={(isAutoGainControlEnabled) =>
          void toggleAutoGain(isAutoGainControlEnabled)
        }
        onResetMicrophoneVolume={() => {
          setMicrophoneSendVolume(1);
          void saveSettings({ microphoneSendVolume: 1 });
        }}
        onSwitchOutputDevice={(deviceId) => void switchOutputDevice(deviceId)}
        onSpeakerVolumePreview={(volume) => getRemoteAudioMixer().setMasterVolume(volume)}
        onSpeakerVolumeCommit={(speakerMasterVolume) => void saveSettings({ speakerMasterVolume })}
        onLoudnessBalanceChange={(isFriendLoudnessBalanceEnabled) => {
          getRemoteAudioMixer().setLoudnessBalanceEnabled(isFriendLoudnessBalanceEnabled);
          void saveSettings({ isFriendLoudnessBalanceEnabled });
        }}
        onTestSpeaker={() => void getRemoteAudioMixer().playTestTone()}
        onResetSpeakerVolume={() => {
          getRemoteAudioMixer().setMasterVolume(1);
          void saveSettings({ speakerMasterVolume: 1 });
        }}
        onToggleRecording={() => void toggleRecording()}
        onToggleScreenShare={() => {
          if (localScreenShareStream) {
            void stopSharingScreen();
            return;
          }
          void openScreenSourcePicker();
        }}
        onToggleOverlay={() => {
          playUiSound("popup-open");
          void window.desktopApi.overlay.toggle().then(setIsOverlayOpen);
        }}
        onLeave={() => void leave()}
      />
    </div>
  );
};
