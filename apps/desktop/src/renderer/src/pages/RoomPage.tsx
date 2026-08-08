import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Copy,
  ExternalLink,
  FolderHeart,
  GripHorizontal,
  Plus,
  Trash2,
  Volume2,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";

import {
  RecordingEncoderState,
  RecordingState,
  RoomConnectionState,
  type GameDetectionSnapshot,
  type AudioDeviceDescriptor,
  type MemberActivity,
  type ScreenCaptureSourceDescriptor,
  type SceneZoneId,
} from "@private-voice/shared";

import { MuteButton } from "../components/audio/MuteButton";
import { RecordingButton } from "../components/audio/RecordingButton";
import { AnimatedControlIcon } from "../components/icons/AnimatedControlIcon";
import { Button } from "../components/base/Button";
import { Slider } from "../components/base/Slider";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { TeamIsland } from "../components/room/TeamIsland";
import { playUiSound } from "../features/audio/uiSound";
import { getRemoteAudioMixer } from "../features/audio/RemoteAudioMixer";
import { motionDuration, motionEase } from "../features/motion/motionSystem";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../features/motion/motionPresets";
import { summarizeConnectionHealth } from "../features/network/networkDiagnostics";
import type { ScreenShareItem } from "../features/screen-share/types";
import { useScreenShare } from "../features/screen-share/useScreenShare";
import {
  decideAutoAway,
  IDLE_POLL_INTERVAL_MS,
  shouldMuteAfterAwayReturn,
} from "../features/room/autoAway";
import { isSeatZone } from "../features/voice-scene/sceneZones";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useRecordingController } from "../hooks/useRecordingController";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { prepareChatImage } from "../utils/chatImage";
import donateQr from "../assets/donate-qr.jpg";

const KNOCK_COOLDOWN_MS = 5_000;
const STALE_SCREEN_FRAME_MS = 6_000;

interface AwaySession {
  method: "auto" | "manual";
  seat: SceneZoneId;
  activity: MemberActivity;
  gameName?: string;
  musicActivity?: GameDetectionSnapshot["musicActivity"];
  enteredAt: string;
}

const ScreenShareVideo = ({ stream }: { stream: MediaStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.muted = true;
    void video.play().catch(() => undefined);
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline muted className="screen-share-video" />;
};

const ScreenShareMedia = ({ item }: { item: ScreenShareItem }) => {
  if (item.isLocal && item.stream) {
    return (
      <div className="screen-share-self-preview" data-testid="local-share-safe-preview">
        <ScreenShareVideo stream={item.stream} />
        <span className="screen-share-self-badge">你的分享</span>
      </div>
    );
  }

  if (item.stream) {
    return <ScreenShareVideo stream={item.stream} />;
  }

  return <img src={item.frameDataUrl} alt="" className="screen-share-video" draggable={false} />;
};

const ScreenSharePanel = ({
  items,
  onStopLocalShare,
  onOpenDetached,
}: {
  items: ScreenShareItem[];
  onStopLocalShare: () => void;
  onOpenDetached: (item: ScreenShareItem) => Promise<void>;
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string>();
  const [isDetaching, setIsDetaching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  }>();
  useEffect(() => {
    if (!items.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id);
    }
  }, [items, selectedId]);
  if (items.length === 0) return null;

  const primaryItem = items.find((item) => item.id === selectedId) ?? items[0];
  if (!primaryItem) return null;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button")) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: position.x,
      baseY: position.y,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!dragState || dragState.pointerId !== event.pointerId || !panel || !parent) return;

    const parentRect = parent.getBoundingClientRect();
    const baseLeft = parentRect.width - panel.offsetWidth - 14;
    const desiredLeft = baseLeft + dragState.baseX + event.clientX - dragState.startX;
    const desiredTop = 14 + dragState.baseY + event.clientY - dragState.startY;
    const clampedLeft = Math.min(
      Math.max(10, desiredLeft),
      Math.max(10, parentRect.width - panel.offsetWidth - 10),
    );
    const clampedTop = Math.min(
      Math.max(10, desiredTop),
      Math.max(10, parentRect.height - panel.offsetHeight - 10),
    );
    setPosition({ x: clampedLeft - baseLeft, y: clampedTop - 14 });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    dragStateRef.current = undefined;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const openDetachedViewer = async () => {
    if (isDetaching) return;
    setIsDetaching(true);
    const minimumHandoff = new Promise<void>((resolve) => {
      window.setTimeout(resolve, motionDuration.panel * 1_000);
    });
    try {
      await Promise.all([onOpenDetached(primaryItem), minimumHandoff]);
    } finally {
      setIsDetaching(false);
    }
  };

  return (
    <div
      ref={panelRef}
      className={`screen-share-panel ${isDetaching ? "is-detaching" : ""} ${isDragging ? "is-dragging" : ""}`}
      data-testid="screen-share-panel"
      style={
        {
          "--screen-share-x": `${position.x}px`,
          "--screen-share-y": `${position.y}px`,
        } as CSSProperties & Record<string, string>
      }
    >
      <div
        className="screen-share-panel-header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <GripHorizontal className="screen-share-drag-handle" aria-hidden="true" />
        <div>
          <p className="screen-share-kicker">屏幕分享</p>
          <strong>{primaryItem.title}</strong>
          <span className="screen-share-transport">
            {primaryItem.transport === "webrtc" ? "实时视频" : "服务器兜底"}
          </span>
        </div>
        <div className="screen-share-panel-actions">
          <button
            type="button"
            className="screen-share-icon-action"
            data-icon-motion="expand"
            disabled={isDetaching}
            onClick={() => void openDetachedViewer()}
            title="在独立窗口中观看"
            aria-label="在独立窗口中观看"
          >
            <AnimatedControlIcon name="overlay" className="h-3.5 w-3.5" />
          </button>
          {primaryItem.isLocal ? (
            <button type="button" className="screen-share-stop" onClick={onStopLocalShare}>
              停止
            </button>
          ) : null}
        </div>
      </div>
      <div className="screen-share-video-shell">
        <ScreenShareMedia item={primaryItem} />
      </div>
      {items.length > 1 ? (
        <div className="screen-share-stack" role="tablist" aria-label="切换共享画面">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === primaryItem.id}
              className={item.id === primaryItem.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              {item.title.replace(" 正在分享", "").replace("你正在分享", "你")}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const AudioControlPopover = ({
  title,
  devices,
  deviceId,
  volume,
  min,
  max,
  onDeviceChange,
  onVolumePreview,
  onVolumeCommit,
  onTest,
  onReset,
}: {
  title: string;
  devices: AudioDeviceDescriptor[];
  deviceId?: string;
  volume: number;
  min: number;
  max: number;
  onDeviceChange: (deviceId?: string) => void;
  onVolumePreview: (volume: number) => void;
  onVolumeCommit: (volume: number) => void;
  onTest?: () => void;
  onReset: () => void;
}) => {
  const [draftVolume, setDraftVolume] = useState(volume);
  useEffect(() => setDraftVolume(volume), [volume]);

  const commit = () => onVolumeCommit(draftVolume);

  return (
    <motion.div
      className="audio-control-popover"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 5, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 360, damping: 30, mass: 0.55 }}
    >
      <div className="audio-control-popover-heading">
        <strong>{title}</strong>
        <span>{Math.round(draftVolume * 100)}%</span>
      </div>
      <select
        value={deviceId || ""}
        aria-label={`${title}设备`}
        onChange={(event) => onDeviceChange(event.currentTarget.value || undefined)}
      >
        <option value="">系统默认</option>
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.label || title}
          </option>
        ))}
      </select>
      <div className="audio-control-popover-slider">
        <Slider
          min={min}
          max={max}
          step={0.05}
          value={draftVolume}
          aria-label={`${title}音量`}
          onChange={(event) => {
            const nextVolume = Number(event.currentTarget.value);
            setDraftVolume(nextVolume);
            onVolumePreview(nextVolume);
          }}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      </div>
      <div className="audio-control-popover-actions">
        {onTest ? (
          <button type="button" className="audio-control-test" onClick={onTest}>
            <Volume2 aria-hidden="true" />
            播放测试音
          </button>
        ) : null}
        <button type="button" className="audio-control-reset" onClick={onReset}>
          恢复 100%
        </button>
      </div>
    </motion.div>
  );
};

export const RoomPage = () => {
  const {
    room,
    leaveRoom,
    switchChannel,
    sendChatMessage,
    sendKnock,
    sendSceneReaction,
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
  const roomAction = useAppStore((state) => state.roomAction);
  const {
    localStream: localScreenShareStream,
    status: screenShareStatus,
    detachedItemId: detachedViewerId,
    openSourcePicker: prepareScreenSourcePicker,
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
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const remoteScreenFrames = useRoomStore((state) => state.remoteScreenFrames);
  const connectionHealth = useRoomStore((state) => state.connectionHealth);
  const sceneReactions = useRoomStore((state) => state.sceneReactions);
  const collectionItems = useRoomStore((state) => state.collectionItems);
  const channelCounts = useRoomStore((state) => state.channelCounts);
  const {
    inputDevices,
    outputDevices,
    isMuted,
    isDeafened,
    toggleMicrophone,
    toggleDeafen,
    setMuted,
  } = useAudioStore();
  const recordingStatus = useRecordingStore((state) => state.status);
  const recordingMarkers = useRecordingStore((state) => state.markers);
  const addRecordingMarker = useRecordingStore((state) => state.addMarker);
  const clearRecordingMarkers = useRecordingStore((state) => state.clearMarkers);
  const { capability, startRecording, stopRecording } = useRecordingController();
  const pageRef = useRef<HTMLDivElement>(null);
  const voicePulseRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [pendingIncludeSystemAudio, setPendingIncludeSystemAudio] = useState(false);
  const [isScreenSourcePickerOpen, setIsScreenSourcePickerOpen] = useState(false);
  const [screenSourcePickerSources, setScreenSourcePickerSources] = useState<
    ScreenCaptureSourceDescriptor[]
  >([]);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [isNoiseSuppressionSwitching, setIsNoiseSuppressionSwitching] = useState(false);
  const [isDonationOpen, setIsDonationOpen] = useState(false);
  const [isCollectionOpen, setIsCollectionOpen] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState("");
  const [isCollectionSaving, setIsCollectionSaving] = useState(false);
  const [localKnockPulse, setLocalKnockPulse] = useState(0);
  const [activeAudioPanel, setActiveAudioPanel] = useState<"microphone" | "speaker">();
  const [screenFrameNow, setScreenFrameNow] = useState(Date.now());
  const [isLeaving, setIsLeaving] = useState(false);
  const lastSeatZoneRef = useRef<SceneZoneId>("gameDesk1");
  const awaySessionRef = useRef<AwaySession>();
  const lastKnockAt = useRef(0);
  const detectedGameRef = useRef<string>();
  const detectedMusicRef = useRef<GameDetectionSnapshot["musicActivity"]>();
  const hasDetectionSnapshotRef = useRef(false);
  const hasAutoStartedRecordingRef = useRef(false);
  const autoRecordRetryCountRef = useRef(0);
  const autoRecordRetryTimerRef = useRef<number>();
  const hasInitializedCollectionReadStateRef = useRef(false);
  const moveLocalMemberRef = useRef(moveLocalMember);
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
  useEffect(() => {
    if (Object.keys(remoteScreenFrames).length === 0) return;
    const timer = window.setInterval(() => setScreenFrameNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [remoteScreenFrames]);

  const isFreshScreenFrame = (receivedAt: string) => {
    const timestamp = Date.parse(receivedAt);
    return Number.isFinite(timestamp) && screenFrameNow - timestamp <= STALE_SCREEN_FRAME_MS;
  };
  const screenShareItems: ScreenShareItem[] = [
    ...(localScreenShareStream
      ? [
          {
            id: "local",
            title: "你正在分享",
            stream: localScreenShareStream,
            isLocal: true,
            transport: "webrtc" as const,
          },
        ]
      : []),
    ...Object.entries(remoteStreams)
      .filter(([, stream]) =>
        stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted),
      )
      .map(([peerId, stream]) => {
        const member = room.members.find((candidate) => candidate.id === peerId);
        return {
          id: peerId,
          title: `${member?.nickname ?? "好友"} 正在分享`,
          stream,
          transport: "webrtc" as const,
        };
      }),
    ...Object.entries(remoteScreenFrames)
      .filter(([peerId, frame]) => {
        const stream = remoteStreams[peerId];
        const hasLiveVideo = stream
          ?.getVideoTracks()
          .some((track) => track.readyState === "live" && !track.muted);
        return Boolean(frame.data) && isFreshScreenFrame(frame.receivedAt) && !hasLiveVideo;
      })
      .map(([peerId, frame]) => {
        const member = room.members.find((candidate) => candidate.id === peerId);
        return {
          id: `${peerId}-relay`,
          title: `${member?.nickname ?? "好友"} 正在分享`,
          frameDataUrl: frame.data,
          transport: "relay" as const,
        };
      }),
  ];
  const localMember = room.members.find((member) => member.isLocal);
  const localMusicActivityKey = JSON.stringify(localMember?.musicActivity ?? null);
  const connectionQuality = summarizeConnectionHealth(connectionHealth);
  const lastCollectionViewedAt = settings?.lastCollectionViewedAt
    ? Date.parse(settings.lastCollectionViewedAt)
    : 0;
  const hasUnreadCollectionItems = Boolean(
    settings?.hasInitializedCollectionReadState &&
    collectionItems.some(
      (item) =>
        item.createdByPeerId !== localMember?.id &&
        Date.parse(item.createdAt) > lastCollectionViewedAt,
    ),
  );
  const screenSharingPeerIds = [
    ...(localScreenShareStream && localMember ? [localMember.id] : []),
    ...Object.entries(remoteStreams)
      .filter(([, stream]) =>
        stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted),
      )
      .map(([peerId]) => peerId),
    ...Object.entries(remoteScreenFrames)
      .filter(([, frame]) => Boolean(frame.data) && isFreshScreenFrame(frame.receivedAt))
      .map(([peerId]) => peerId),
  ].filter((peerId, index, peers) => peers.indexOf(peerId) === index);

  const detachedViewerItem = detachedViewerId
    ? screenShareItems.find((item) => item.id === detachedViewerId)
    : undefined;
  const detachedViewerSnapshot = {
    id: detachedViewerItem?.id,
    title: detachedViewerItem?.title,
    stream: detachedViewerItem?.stream,
    frameDataUrl: detachedViewerItem?.frameDataUrl,
    isLocal: detachedViewerItem?.isLocal,
    transport: detachedViewerItem?.transport,
  };

  useEffect(() => {
    const item: ScreenShareItem | undefined = detachedViewerSnapshot.id
      ? {
          id: detachedViewerSnapshot.id,
          title: detachedViewerSnapshot.title ?? "屏幕分享",
          stream: detachedViewerSnapshot.stream,
          frameDataUrl: detachedViewerSnapshot.frameDataUrl,
          isLocal: detachedViewerSnapshot.isLocal,
          transport: detachedViewerSnapshot.transport ?? "webrtc",
        }
      : undefined;
    void syncDetachedItem(item);
  }, [
    detachedViewerSnapshot.frameDataUrl,
    detachedViewerSnapshot.id,
    detachedViewerSnapshot.isLocal,
    detachedViewerSnapshot.stream,
    detachedViewerSnapshot.title,
    detachedViewerSnapshot.transport,
    syncDetachedItem,
  ]);

  useLayoutEffect(() => {
    if (!pageRef.current) return;

    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set(pageRef.current, { clearProps: "all" });
        return;
      }

      gsap.fromTo(
        pageRef.current,
        { autoAlpha: 0.94, y: 5 },
        {
          autoAlpha: 1,
          y: 0,
          duration: motionDuration.message,
          ease: motionEase.spatial,
          force3D: true,
          clearProps: "transform,opacity,visibility",
        },
      );
    }, pageRef);

    return () => context.revert();
  }, [reduceMotion]);

  useLayoutEffect(() => {
    if (reduceMotion || !voicePulseRef.current) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-gsap-voice='primary']",
        { scale: 0.96 },
        {
          scale: 1,
          duration: motionDuration.feedback,
          ease: motionEase.feedback,
          overwrite: true,
          force3D: true,
        },
      );
    }, voicePulseRef);

    return () => context.revert();
  }, [isDeafened, isMuted, reduceMotion]);

  useEffect(() => {
    void window.desktopApi.overlay.update({
      members: room.members,
      isMuted,
      isDeafened,
      connectionState: room.connectionState,
      isRecording: recordingStatus.state === RecordingState.Recording,
      isScreenSharing: Boolean(localScreenShareStream),
      hasSystemAudio: Boolean(
        localScreenShareStream?.getAudioTracks().some((track) => track.readyState === "live"),
      ),
    });
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
    if (
      !settings ||
      settings.hasInitializedCollectionReadState ||
      hasInitializedCollectionReadStateRef.current
    ) {
      return;
    }

    hasInitializedCollectionReadStateRef.current = true;
    const newestCreatedAt = collectionItems.reduce(
      (latest, item) => Math.max(latest, Date.parse(item.createdAt) || 0),
      Date.now(),
    );
    void saveSettings({
      hasInitializedCollectionReadState: true,
      lastCollectionViewedAt: new Date(newestCreatedAt).toISOString(),
    });
  }, [collectionItems, saveSettings, settings]);

  useEffect(() => {
    hasAutoStartedRecordingRef.current = false;
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
      settings?.isAutoRecordOnJoinEnabled &&
      canSend &&
      hasLiveMicrophone &&
      recordingStatus.state === RecordingState.Idle &&
      capability.encoderState !== RecordingEncoderState.Unsupported;

    if (!canAutoRecord || hasAutoStartedRecordingRef.current) return;

    const attemptAutoRecord = () => {
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
          description: "退出频道或手动停止时会让你选择保存位置。",
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
    settings?.isAutoRecordOnJoinEnabled,
    startRecording,
  ]);

  useEffect(() => {
    if (settings?.isOverlayEnabled === false) {
      void window.desktopApi.overlay.close().then(() => setIsOverlayOpen(false));
      return;
    }
    void window.desktopApi.overlay.show().then(setIsOverlayOpen);
  }, [settings?.isOverlayEnabled]);

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
    if (!localMember) return;
    if (localMember.sceneZone && isSeatZone(localMember.sceneZone)) {
      lastSeatZoneRef.current = localMember.sceneZone;
    }
  }, [localMember]);

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
          musicActivity: currentLocalMember.musicActivity,
          enteredAt: new Date().toISOString(),
        };
        setMuted(true);
        moveLocalMemberRef.current(
          "restroomZone",
          "restroom",
          currentLocalMember.gameName,
          currentLocalMember.musicActivity,
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
      detectedMusicRef.current = snapshot.musicActivity;
      const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
      const currentZone = localMember?.sceneZone ?? "gameDesk1";

      if (snapshot.gameName) {
        if (currentZone === "restroomZone") {
          moveLocalMemberRef.current(
            "restroomZone",
            "restroom",
            snapshot.gameName,
            snapshot.musicActivity,
          );
        } else {
          const gameZone = currentZone.startsWith("gameDesk") ? currentZone : "gameDesk1";
          moveLocalMemberRef.current(gameZone, "gaming", snapshot.gameName, snapshot.musicActivity);
        }
      } else if (previousGame) {
        moveLocalMemberRef.current(
          currentZone,
          currentZone === "restroomZone" ? "restroom" : "idle",
          undefined,
          snapshot.musicActivity,
        );
      } else {
        moveLocalMemberRef.current(
          currentZone,
          currentZone === "restroomZone" ? "restroom" : (localMember?.activity ?? "idle"),
          undefined,
          snapshot.musicActivity,
        );
      }
    };

    void window.desktopApi.games.getSnapshot().then(applyGameDetection);
    return window.desktopApi.games.onDetected(applyGameDetection);
  }, []);

  useEffect(() => {
    if (!hasDetectionSnapshotRef.current || !localMember) return;

    const detectedMusicActivityKey = JSON.stringify(detectedMusicRef.current ?? null);
    if (detectedMusicActivityKey === localMusicActivityKey) return;

    const sceneZone = localMember.sceneZone ?? "gameDesk1";
    moveLocalMemberRef.current(
      sceneZone,
      sceneZone === "restroomZone"
        ? "restroom"
        : detectedGameRef.current
          ? "gaming"
          : (localMember.activity ?? "idle"),
      detectedGameRef.current,
      detectedMusicRef.current,
    );
  }, [localMember, localMusicActivityKey, room.connectionState]);

  const send = async (content = chatInput) => {
    if (!content.trim()) return;
    await sendChatMessage(content);
    playUiSound("send-message");
    if (content === chatInput) setChatInput("");
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
        const result = await stopRecording();
        if (recordingMarkers.length) {
          await window.desktopApi.recording.saveMarkers(result.filePath, recordingMarkers);
        }
        clearRecordingMarkers();
        playUiSound("record-stop");
        return;
      }

      clearRecordingMarkers();
      const status = startRecording();
      if (status.state !== RecordingState.Recording) {
        throw new Error(status.message || "recording_start_failed");
      }
      playUiSound("record-start");
    } catch {
      pushToast({ tone: "danger", title: "录音失败", description: "请稍后再试。" });
    }
  };

  const leave = async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    try {
      if (recordingStatus.state === RecordingState.Recording) {
        const result = await stopRecording();
        if (recordingMarkers.length) {
          await window.desktopApi.recording.saveMarkers(result.filePath, recordingMarkers);
        }
        clearRecordingMarkers();
        playUiSound("record-stop");
      }
      await shutdownScreenShare();
      await window.desktopApi.overlay.close();
      await leaveRoom();
    } catch (error) {
      setIsLeaving(false);
      pushToast({
        tone: "danger",
        title: "暂时无法退出",
        description:
          recordingStatus.state === RecordingState.Recording
            ? "录音还没有保存完成，请处理保存窗口后再试。"
            : "清理房间资源失败，请再试一次。",
      });
      await window.desktopApi.app.writeLog({
        category: "app",
        level: "error",
        message: "room_leave_cleanup_failed",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  const startSharingScreen = async (sourceId: string) => {
    try {
      setIsScreenSourcePickerOpen(false);
      setScreenSourcePickerSources([]);
      const stream = await startManagedScreenShare({
        sourceId,
        includeSystemAudio: pendingIncludeSystemAudio,
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
    try {
      const sources = await prepareScreenSourcePicker();
      setScreenSourcePickerSources(sources);
      setPendingIncludeSystemAudio(false);
      setIsScreenSourcePickerOpen(true);
    } catch {
      pushToast({
        tone: "danger",
        title: "没有找到可分享的画面",
        description: "请确认 Windows 允许上号进行屏幕捕获后重试。",
      });
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
    if (!settings || isNoiseSuppressionSwitching) return;
    const isNoiseSuppressionEnabled = !settings.isNoiseSuppressionEnabled;
    setIsNoiseSuppressionSwitching(true);
    try {
      await saveSettings({ isNoiseSuppressionEnabled });
      await replaceInputDevice(settings.preferredInputDeviceId);
      playUiSound("button-click");
      pushToast({
        tone: isNoiseSuppressionEnabled ? "success" : "neutral",
        title: isNoiseSuppressionEnabled ? "降噪已开启" : "降噪已关闭",
        description: isNoiseSuppressionEnabled
          ? "DeepFilterNet 正在本机实时处理麦克风。"
          : "现在发送麦克风原声。",
      });
      await window.desktopApi.app.writeLog({
        category: "audio",
        level: "info",
        message: "deepfilter_user_toggle",
        context: { enabled: isNoiseSuppressionEnabled },
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

  const openCollection = () => {
    playUiSound("popup-open");
    setIsCollectionOpen(true);
    if (!settings) return;
    void saveSettings({
      hasInitializedCollectionReadState: true,
      lastCollectionViewedAt: new Date().toISOString(),
    });
  };

  const openCollectionItem = async (content: string) => {
    try {
      const url = new URL(content);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      await window.desktopApi.app.openExternal(url.toString());
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "链接无法打开",
        description: "这个链接格式不正确，已阻止打开。",
      });
      await window.desktopApi.app.writeLog({
        category: "app",
        level: "warn",
        message: "collection_external_link_rejected",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  const saveCollectionDraft = async () => {
    const content = collectionDraft.trim();
    if (!content || isCollectionSaving) return;
    let parsedUrl: URL | undefined;
    try {
      const candidate = new URL(content);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") parsedUrl = candidate;
    } catch {
      parsedUrl = undefined;
    }
    const isLink = parsedUrl !== undefined;
    const normalizedPath = parsedUrl?.pathname.toLocaleLowerCase() ?? "";
    const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((extension) =>
      normalizedPath.endsWith(extension),
    );
    let title = content.slice(0, 36);
    if (parsedUrl) title = parsedUrl.hostname.replace(/^www\./, "") || "频道链接";

    setIsCollectionSaving(true);
    try {
      await addRoomCollectionItem(isImage ? "image" : isLink ? "link" : "text", title, content);
      setCollectionDraft("");
      playUiSound("send-message");
    } catch {
      pushToast({
        tone: "danger",
        title: "珍藏失败",
        description: "连接还没有恢复，请稍后再试。",
      });
    } finally {
      setIsCollectionSaving(false);
    }
  };

  const copyCollectionItem = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      playUiSound("button-click");
      pushToast({ tone: "success", title: "已复制", description: "珍藏内容已放进剪贴板。" });
    } catch {
      pushToast({ tone: "danger", title: "复制失败", description: "请稍后再试。" });
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
        musicActivity: localMember?.musicActivity,
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
      <div data-gsap-room="topbar">
        <TopStatusBar
          currentChannelId={room.roomId === "side" ? "side" : "main"}
          channelCounts={channelCounts}
          isSwitchingChannel={roomAction === "joining"}
          onSwitchChannel={(channelId) => void switchChannel(channelId)}
          onDonate={() => setIsDonationOpen(true)}
          onKnock={() => void knock()}
          onInvite={() => void copyInviteLink()}
        />
      </div>

      <main className="room-main-grid grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[minmax(0,1.44fr)_minmax(280px,.56fr)]">
        <section
          data-gsap-room="island"
          className="room-scene-column island-panel min-h-0 overflow-hidden"
        >
          <TeamIsland
            members={room.members}
            onZoneSelect={handleZoneSelect}
            onReact={(targetPeerId, emoji) => void sendSceneReaction(targetPeerId, emoji)}
            onVolumeChange={setMemberVolume}
            screenSharingPeerIds={screenSharingPeerIds}
            networkQuality={connectionQuality.level}
            reactions={sceneReactions}
            knockPulse={
              localKnockPulse +
              chatMessages.filter((message) => message.id.startsWith("knock-")).length
            }
            reduceMotion={reduceMotion}
          />
          <ScreenSharePanel
            items={screenShareItems}
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
          />
        </section>
        <div data-gsap-room="chat" className="room-chat-column min-h-0">
          <TemporaryChatPanel
            className="h-full"
            messages={chatMessages}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onSend={() => void send()}
            onQuickSend={(message) => void send(message)}
            onSendImage={sendImage}
            canSend={canSend}
            unavailableLabel="正在重连..."
            reduceMotion={reduceMotion}
          />
        </div>
      </main>

      <AnimatePresence>
        {isScreenSourcePickerOpen ? (
          <motion.div
            key="screen-source-picker"
            className="screen-source-picker-backdrop"
            variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
            initial="initial"
            animate="open"
            exit="closed"
            role="presentation"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setIsScreenSourcePickerOpen(false);
            }}
          >
            <motion.section
              className="screen-source-picker-panel modal-surface"
              variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
              initial="initial"
              animate="open"
              exit="closed"
              role="dialog"
              aria-modal="true"
              aria-label="选择要分享的画面"
            >
              <header>
                <div>
                  <h2>分享哪个画面？</h2>
                  <p>固定使用 1440p 清晰画质。显示器已编号，窗口会显示应用名称。</p>
                </div>
                <Button variant="ghost" onClick={() => setIsScreenSourcePickerOpen(false)}>
                  取消
                </Button>
              </header>
              <div className="screen-source-options">
                <span className="screen-source-quality-badge">1440p · 清晰</span>
                <button
                  type="button"
                  className={`screen-audio-toggle ${pendingIncludeSystemAudio ? "active" : ""}`}
                  aria-pressed={pendingIncludeSystemAudio}
                  onClick={() => setPendingIncludeSystemAudio((current) => !current)}
                >
                  <span aria-hidden="true">{pendingIncludeSystemAudio ? "✓" : ""}</span>
                  系统音频
                </button>
              </div>
              <div className="screen-source-picker-grid">
                {screenSourcePickerSources.map((source, index) => (
                  <button
                    key={source.id}
                    type="button"
                    className="screen-source-picker-item"
                    onClick={() => void startSharingScreen(source.id)}
                  >
                    <span className="screen-source-thumbnail">
                      <strong className="screen-source-identity">
                        {source.displayLabel ??
                          (source.kind === "screen" ? `显示器 ${index + 1}` : "窗口")}
                      </strong>
                      {source.thumbnailDataUrl ? (
                        <img src={source.thumbnailDataUrl} alt="" draggable={false} />
                      ) : (
                        <span className="screen-source-thumbnail-fallback">暂无预览</span>
                      )}
                    </span>
                    <span className="screen-source-name">
                      {source.appIconDataUrl ? <img src={source.appIconDataUrl} alt="" /> : null}
                      <span>{source.name}</span>
                      <small>{source.kind === "screen" ? "显示器" : "窗口"}</small>
                    </span>
                  </button>
                ))}
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isDonationOpen ? (
          <motion.div
            className="donation-modal-backdrop modal-scrim"
            role="presentation"
            variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
            initial="initial"
            animate="open"
            exit="closed"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setIsDonationOpen(false);
            }}
          >
            <motion.section
              className="donation-modal-panel modal-surface"
              role="dialog"
              aria-modal="true"
              aria-labelledby="donation-modal-title"
              variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
              initial="initial"
              animate="open"
              exit="closed"
            >
              <span className="donation-modal-kicker">小惊喜</span>
              <h2 id="donation-modal-title">请作者喝杯咖啡</h2>
              <p>如果上号让你和朋友多开了一局，就请我补充一点续航。</p>
              <div className="donation-qr-shell">
                <img src={donateQr} alt="请作者喝咖啡的收款二维码" draggable={false} />
              </div>
              <div className="donation-modal-actions">
                <span>微信扫码，心意随缘</span>
                <Button variant="secondary" onClick={() => setIsDonationOpen(false)}>
                  收下啦
                </Button>
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isCollectionOpen ? (
          <motion.div
            key="room-collection"
            className="collection-modal-backdrop modal-scrim"
            role="presentation"
            variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
            initial="initial"
            animate="open"
            exit="closed"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setIsCollectionOpen(false);
            }}
          >
            <motion.section
              className="collection-modal-panel modal-surface"
              role="dialog"
              aria-modal="true"
              aria-labelledby="collection-modal-title"
              variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
              initial="initial"
              animate="open"
              exit="closed"
            >
              <header className="collection-modal-header">
                <div>
                  <span>朋友的小收藏箱</span>
                  <h2 id="collection-modal-title">频道珍藏</h2>
                  <p>留下一句话或链接，会一直保留，直到有人手动删除。</p>
                </div>
                <Button variant="ghost" onClick={() => setIsCollectionOpen(false)}>
                  收起
                </Button>
              </header>

              <div className="collection-composer">
                <textarea
                  value={collectionDraft}
                  maxLength={2_000}
                  placeholder="写一句约定，或贴一个链接…"
                  onChange={(event) => setCollectionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                      event.preventDefault();
                      void saveCollectionDraft();
                    }
                  }}
                />
                <Button
                  variant="primary"
                  disabled={!collectionDraft.trim() || isCollectionSaving}
                  onClick={() => void saveCollectionDraft()}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {isCollectionSaving ? "保存中" : "珍藏"}
                </Button>
              </div>

              <div className="collection-list">
                {collectionItems.length ? (
                  [...collectionItems].reverse().map((item) => (
                    <article key={item.id} className="collection-item">
                      <div className="collection-item-copy">
                        <span>
                          {item.kind === "text" ? "便笺" : item.kind === "game" ? "游戏" : "链接"}
                        </span>
                        <strong>{item.title}</strong>
                        <p>{item.content}</p>
                        <small>由 {item.createdByNickname} 留下</small>
                      </div>
                      <div className="collection-item-actions">
                        {item.kind === "link" || item.kind === "image" ? (
                          <button
                            type="button"
                            title="在浏览器中打开"
                            aria-label={`打开 ${item.title}`}
                            onClick={() => void openCollectionItem(item.content)}
                          >
                            <ExternalLink aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title="复制"
                          aria-label={`复制 ${item.title}`}
                          onClick={() => void copyCollectionItem(item.content)}
                        >
                          <Copy aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          title="删除"
                          aria-label={`删除 ${item.title}`}
                          onClick={() => void removeRoomCollectionItem(item.id)}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="collection-empty">
                    <FolderHeart aria-hidden="true" />
                    <strong>这里还空着</strong>
                    <span>把下次开黑时间、攻略链接或一句约定留在这里。</span>
                  </div>
                )}
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <footer
        ref={voicePulseRef}
        data-gsap-room="dock"
        className="voice-dock flex items-center gap-2 px-3 py-2.5"
      >
        <span data-gsap-voice="primary" className="inline-flex">
          <MuteButton isMuted={isMuted} onClick={handleToggleMicrophone} />
        </span>
        <Button
          variant={isDeafened ? "danger" : "ghost"}
          data-icon-motion="speaker"
          data-gsap-voice="primary"
          data-ui-sound="handled"
          className={`voice-action-button-with-text voice-main-control ${isDeafened ? "voice-main-control-danger" : ""}`}
          onClick={toggleDeafen}
        >
          <AnimatedControlIcon
            name="speaker"
            muted={isDeafened}
            active={!isDeafened}
            className="h-4 w-4"
          />
          <span className="voice-action-label">{isDeafened ? "扬声器关" : "扬声器开"}</span>
        </Button>
        <div className="audio-control-anchor" data-audio-control-root>
          <button
            type="button"
            className={`audio-control-trigger ${activeAudioPanel === "microphone" ? "is-active" : ""}`}
            data-icon-motion="device"
            title="麦克风设备与发送音量"
            aria-label="麦克风设备与发送音量"
            aria-expanded={activeAudioPanel === "microphone"}
            onClick={() =>
              setActiveAudioPanel((current) =>
                current === "microphone" ? undefined : "microphone",
              )
            }
          >
            <AnimatedControlIcon name="headphones" className="h-4 w-4" />
          </button>
          <AnimatePresence>
            {activeAudioPanel === "microphone" && settings ? (
              <AudioControlPopover
                title="麦克风"
                devices={inputDevices}
                deviceId={settings.preferredInputDeviceId}
                volume={settings.microphoneSendVolume}
                min={0.5}
                max={1.5}
                onDeviceChange={(deviceId) => void switchInputDevice(deviceId)}
                onVolumePreview={setMicrophoneSendVolume}
                onVolumeCommit={(microphoneSendVolume) =>
                  void saveSettings({ microphoneSendVolume })
                }
                onReset={() => {
                  setMicrophoneSendVolume(1);
                  void saveSettings({ microphoneSendVolume: 1 });
                }}
              />
            ) : null}
          </AnimatePresence>
        </div>
        <div className="audio-control-anchor" data-audio-control-root>
          <button
            type="button"
            className={`audio-control-trigger ${activeAudioPanel === "speaker" ? "is-active" : ""}`}
            data-icon-motion="device"
            title="扬声器设备与总音量"
            aria-label="扬声器设备与总音量"
            aria-expanded={activeAudioPanel === "speaker"}
            onClick={() =>
              setActiveAudioPanel((current) => (current === "speaker" ? undefined : "speaker"))
            }
          >
            <AnimatedControlIcon name="speaker" active className="h-4 w-4" />
          </button>
          <AnimatePresence>
            {activeAudioPanel === "speaker" && settings ? (
              <AudioControlPopover
                title="扬声器"
                devices={outputDevices}
                deviceId={settings.preferredOutputDeviceId}
                volume={settings.speakerMasterVolume}
                min={0}
                max={2}
                onDeviceChange={(deviceId) => void switchOutputDevice(deviceId)}
                onVolumePreview={(volume) => getRemoteAudioMixer().setMasterVolume(volume)}
                onVolumeCommit={(speakerMasterVolume) => void saveSettings({ speakerMasterVolume })}
                onTest={() => void getRemoteAudioMixer().playTestTone()}
                onReset={() => {
                  getRemoteAudioMixer().setMasterVolume(1);
                  void saveSettings({ speakerMasterVolume: 1 });
                }}
              />
            ) : null}
          </AnimatePresence>
        </div>
        <div className="flex-1" />
        <Button
          variant={settings?.isNoiseSuppressionEnabled ? "secondary" : "ghost"}
          data-icon-motion="noise"
          data-ui-sound="handled"
          className={`voice-action-button-with-text noise-suppression-button ${
            settings?.isNoiseSuppressionEnabled ? "is-active" : ""
          }`}
          disabled={!settings || isNoiseSuppressionSwitching}
          aria-pressed={settings?.isNoiseSuppressionEnabled ?? false}
          onClick={() => void toggleNoiseSuppression()}
        >
          <AnimatedControlIcon
            name="noise"
            active={settings?.isNoiseSuppressionEnabled}
            className="h-4 w-4"
          />
          <span className="voice-action-label">
            {isNoiseSuppressionSwitching ? "切换中" : "降噪"}
          </span>
        </Button>
        <Button
          variant={isCollectionOpen ? "secondary" : "ghost"}
          data-icon-motion="collection"
          className="voice-action-button-with-text collection-button"
          aria-pressed={isCollectionOpen}
          onClick={openCollection}
        >
          <motion.span
            className="collection-button-icon"
            whileHover={reduceMotion ? undefined : { rotate: -7, scale: 1.08 }}
            transition={{ type: "spring", stiffness: 360, damping: 28, mass: 0.55 }}
          >
            <FolderHeart className="h-4 w-4" aria-hidden="true" />
          </motion.span>
          <span className="voice-action-label">珍藏</span>
          {hasUnreadCollectionItems ? (
            <span className="collection-unread-dot" aria-label="有新珍藏" />
          ) : null}
        </Button>
        <RecordingButton
          isRecording={recordingStatus.state === RecordingState.Recording}
          onClick={() => void toggleRecording()}
          disabled={capability.encoderState === RecordingEncoderState.Unsupported}
        />
        {recordingStatus.state === RecordingState.Recording ? (
          <Button
            variant="ghost"
            data-icon-motion="bookmark"
            className="voice-action-button-with-text"
            onClick={() => {
              const startedAt = recordingStatus.startedAt ?? Date.now();
              addRecordingMarker({
                id: crypto.randomUUID(),
                offsetMs: Math.max(0, Date.now() - startedAt),
                createdAt: new Date().toISOString(),
              });
              playUiSound("button-click");
            }}
          >
            <AnimatedControlIcon name="bookmark" className="h-4 w-4" />
            <span className="voice-action-label">标记 {recordingMarkers.length}</span>
          </Button>
        ) : null}
        <Button
          variant={localScreenShareStream ? "secondary" : "ghost"}
          data-icon-motion="screen-share"
          className={`voice-action-button-with-text ${
            localScreenShareStream || isScreenShareStarting ? "screen-share-active-button" : ""
          }`}
          disabled={isScreenShareStarting}
          aria-pressed={Boolean(localScreenShareStream)}
          onClick={() => {
            if (localScreenShareStream) {
              void stopSharingScreen();
              return;
            }
            void openScreenSourcePicker();
          }}
        >
          <AnimatedControlIcon
            name="screen-share"
            active={Boolean(localScreenShareStream)}
            className="h-4 w-4"
          />
          <span className="voice-action-label">
            {isScreenShareStarting ? "正在开启…" : localScreenShareStream ? "正在分享" : "屏幕分享"}
          </span>
        </Button>
        <Button
          variant={isOverlayOpen ? "secondary" : "ghost"}
          data-icon-motion="overlay"
          className={`voice-action-button-with-text ${isOverlayOpen ? "overlay-active-button" : ""}`}
          onClick={() => {
            playUiSound("popup-open");
            void window.desktopApi.overlay.toggle().then(setIsOverlayOpen);
          }}
        >
          <AnimatedControlIcon name="overlay" active={isOverlayOpen} className="h-4 w-4" />
          <span className="voice-action-label">{isOverlayOpen ? "悬浮窗开" : "悬浮窗关"}</span>
        </Button>
        <Button
          variant="danger"
          data-icon-motion="exit"
          className="voice-action-button-with-text voice-exit-button"
          disabled={isLeaving}
          onClick={() => void leave()}
        >
          <AnimatedControlIcon name="exit" className="h-4 w-4" />
          <span className="voice-action-label">{isLeaving ? "退出中" : "退出"}</span>
        </Button>
      </footer>
    </div>
  );
};
