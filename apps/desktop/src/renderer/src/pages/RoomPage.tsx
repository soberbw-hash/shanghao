import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GripHorizontal } from "lucide-react";
import { gsap } from "gsap";

import {
  RecordingEncoderState,
  RecordingState,
  RoomConnectionState,
  type GameDetectionSnapshot,
  type MemberActivity,
  type ScreenCaptureSourceDescriptor,
  type SceneZoneId,
  type ScreenShareQuality,
} from "@private-voice/shared";
import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";

import { MuteButton } from "../components/audio/MuteButton";
import { RecordingButton } from "../components/audio/RecordingButton";
import { AnimatedControlIcon } from "../components/icons/AnimatedControlIcon";
import { Button } from "../components/base/Button";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { TeamIsland } from "../components/room/TeamIsland";
import { playUiSound } from "../features/audio/uiSound";
import { motionDuration, motionEase } from "../features/motion/motionSystem";
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

const KNOCK_COOLDOWN_MS = 5_000;

interface AwaySession {
  method: "auto" | "manual";
  seat: SceneZoneId;
  activity: MemberActivity;
  gameName?: string;
  wasMuted: boolean;
  enteredAt: string;
}
const SCREEN_SHARE_PROFILES: Record<ScreenShareQuality, ScreenShareEncodingProfile> = {
  "720p": {
    maxBitrate: 360_000,
    maxFramerate: 15,
    maxWidth: 1_280,
    maxHeight: 720,
  },
  "1080p": {
    maxBitrate: 650_000,
    maxFramerate: 18,
    maxWidth: 1_920,
    maxHeight: 1_080,
  },
};
interface ScreenShareItem {
  id: string;
  title: string;
  stream?: MediaStream;
  frameDataUrl?: string;
  isLocal?: boolean;
  transport: "webrtc" | "relay";
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
  if (item.isLocal) {
    return (
      <div className="screen-share-local-placeholder" data-testid="local-share-safe-preview">
        <span className="screen-share-local-placeholder-icon">
          <AnimatedControlIcon name="screen-share" active className="h-5 w-5" />
        </span>
        <strong>你的屏幕正在分享</strong>
        <span>本地预览已隐藏，避免画面无限套娃</span>
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

export const RoomPage = () => {
  const {
    room,
    leaveRoom,
    sendChatMessage,
    sendKnock,
    sendSceneReaction,
    replaceInputDevice,
    copyInviteLink,
    moveLocalMember,
    setMemberVolume,
    startScreenShare,
    stopScreenShare,
  } = useRoomState();
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const remoteScreenFrames = useRoomStore((state) => state.remoteScreenFrames);
  const sceneReactions = useRoomStore((state) => state.sceneReactions);
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
  const [localScreenShareStream, setLocalScreenShareStream] = useState<MediaStream>();
  const [isScreenShareStarting, setIsScreenShareStarting] = useState(false);
  const [detachedViewerId, setDetachedViewerId] = useState<string>();
  const [pendingScreenShareQuality, setPendingScreenShareQuality] =
    useState<ScreenShareQuality>("720p");
  const [screenCaptureSources, setScreenCaptureSources] = useState<ScreenCaptureSourceDescriptor[]>(
    [],
  );
  const [isScreenSourcePickerOpen, setIsScreenSourcePickerOpen] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const lastSeatZoneRef = useRef<SceneZoneId>("gameDesk1");
  const awaySessionRef = useRef<AwaySession>();
  const lastKnockAt = useRef(0);
  const detectedGameRef = useRef<string>();
  const screenShareStoppingRef = useRef(false);
  const localScreenShareActiveRef = useRef(false);
  const moveLocalMemberRef = useRef(moveLocalMember);
  moveLocalMemberRef.current = moveLocalMember;
  const reduceMotion = usePrefersReducedMotion();

  const canSend =
    room.connectionState === RoomConnectionState.Connected ||
    room.connectionState === RoomConnectionState.WaitingPeer ||
    room.connectionState === RoomConnectionState.WaitingSnapshot;
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
        return Boolean(frame.data) && !hasLiveVideo;
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

  const detachedViewerItem = detachedViewerId
    ? screenShareItems.find((item) => item.id === detachedViewerId)
    : undefined;
  const hasDetachedViewerItem = Boolean(detachedViewerItem);

  useEffect(() => {
    if (!detachedViewerId) return;
    if (hasDetachedViewerItem) return;
    setDetachedViewerId(undefined);
    void window.desktopApi.screenShareViewer.close();
  }, [detachedViewerId, hasDetachedViewerItem]);

  useEffect(() => {
    if (!detachedViewerId || !detachedViewerItem?.frameDataUrl) return;
    void window.desktopApi.screenShareViewer
      .updateFrame({ title: detachedViewerItem.title, dataUrl: detachedViewerItem.frameDataUrl })
      .then((isOpen) => {
        if (!isOpen) setDetachedViewerId(undefined);
      })
      .catch(() => setDetachedViewerId(undefined));
  }, [detachedViewerId, detachedViewerItem?.frameDataUrl, detachedViewerItem?.title]);

  useEffect(() => {
    const stream = detachedViewerItem?.stream;
    if (!detachedViewerId || !stream) return;
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    let disposed = false;
    let sending = false;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => undefined);

    const sendFrame = async () => {
      if (disposed || sending || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) return;
      const maxWidth = settings?.screenShareQuality === "1080p" ? 1_440 : 1_120;
      const scale = Math.min(1, maxWidth / sourceWidth);
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
      if (canvas.width !== targetWidth) canvas.width = targetWidth;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      sending = true;
      try {
        const isOpen = await window.desktopApi.screenShareViewer.updateFrame({
          title: detachedViewerItem.title,
          dataUrl: canvas.toDataURL("image/jpeg", 0.78),
        });
        if (!isOpen && !disposed) setDetachedViewerId(undefined);
      } catch {
        if (!disposed) setDetachedViewerId(undefined);
      } finally {
        sending = false;
      }
    };
    const timer = window.setInterval(() => void sendFrame(), 160);
    void sendFrame();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      video.pause();
      video.srcObject = null;
    };
  }, [
    detachedViewerId,
    detachedViewerItem?.stream,
    detachedViewerItem?.title,
    settings?.screenShareQuality,
  ]);

  useEffect(
    () => () => {
      void window.desktopApi.screenShareViewer.close();
    },
    [],
  );

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
    });
  }, [isDeafened, isMuted, room.connectionState, room.members]);

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

      const decision = decideAutoAway({
        idleSeconds,
        isInAwayZone: currentLocalMember.sceneZone === "restroomZone",
        awayMethod: awaySessionRef.current?.method,
      });

      if (decision === "auto_away") {
        const currentZone = currentLocalMember.sceneZone ?? lastSeatZoneRef.current;
        const seat = isSeatZone(currentZone) ? currentZone : lastSeatZoneRef.current;
        awaySessionRef.current = {
          method: "auto",
          seat,
          activity: currentLocalMember.activity ?? "idle",
          gameName: currentLocalMember.gameName,
          wasMuted: useAudioStore.getState().isMuted,
          enteredAt: new Date().toISOString(),
        };
        setMuted(true);
        moveLocalMemberRef.current("restroomZone", "restroom");
        void window.desktopApi.app.writeLog({
          category: "app",
          level: "info",
          message: "auto_away",
          context: { idleSeconds, seat, gameName: currentLocalMember.gameName },
        });
        pushToast({
          tone: "neutral",
          title: "30 分钟没有操作，已切到离开一下。",
          description: "重新操作电脑后会自动回到原来的位置。",
        });
        return;
      }

      const awaySession = awaySessionRef.current;
      if (decision === "auto_return" && awaySession?.method === "auto") {
        awaySessionRef.current = undefined;
        const shouldRemainMuted = shouldMuteAfterAwayReturn({
          wasMuted: awaySession.wasMuted,
          isDeafened: useAudioStore.getState().isDeafened,
        });
        setMuted(shouldRemainMuted);
        moveLocalMemberRef.current(
          awaySession.seat,
          awaySession.gameName ? "gaming" : awaySession.activity,
          awaySession.gameName,
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
          description: shouldRemainMuted ? "麦克风保持离开前的静音状态。" : "麦克风已恢复。",
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
      const previousGame = detectedGameRef.current;
      detectedGameRef.current = snapshot.gameName;
      const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
      const currentZone = localMember?.sceneZone ?? "gameDesk1";

      if (snapshot.gameName) {
        if (currentZone === "restroomZone") {
          moveLocalMemberRef.current("restroomZone", "restroom", snapshot.gameName);
        } else {
          const gameZone = currentZone.startsWith("gameDesk") ? currentZone : "gameDesk1";
          moveLocalMemberRef.current(gameZone, "gaming", snapshot.gameName);
        }
      } else if (previousGame) {
        moveLocalMemberRef.current(
          currentZone,
          currentZone === "restroomZone" ? "restroom" : "idle",
        );
      }
    };

    void window.desktopApi.games.getSnapshot().then(applyGameDetection);
    return window.desktopApi.games.onDetected(applyGameDetection);
  }, []);

  const send = async (content = chatInput) => {
    if (!content.trim()) return;
    await sendChatMessage(content);
    playUiSound("send-message");
    if (content === chatInput) setChatInput("");
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
      startRecording();
      playUiSound("record-start");
    } catch {
      pushToast({ tone: "danger", title: "录音失败", description: "请稍后再试。" });
    }
  };

  const leave = async () => {
    await window.desktopApi.overlay.close();
    await leaveRoom();
  };

  const startSharingScreen = async (sourceId: string, quality: ScreenShareQuality) => {
    let requestedStream: MediaStream | undefined;
    setIsScreenShareStarting(true);
    try {
      await window.desktopApi.screenCapture.selectSource(sourceId);
      setIsScreenSourcePickerOpen(false);
      const profile = SCREEN_SHARE_PROFILES[quality];
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: profile.maxWidth, max: profile.maxWidth },
          height: { ideal: profile.maxHeight, max: profile.maxHeight },
          frameRate: {
            ideal: Math.max(10, profile.maxFramerate - 3),
            max: profile.maxFramerate,
          },
        },
        audio: settings?.isScreenShareSystemAudioEnabled !== false,
      });
      requestedStream = stream;
      const [videoTrack] = stream.getVideoTracks();
      if (!videoTrack) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("screen_track_missing");
      }

      await startScreenShare(stream, profile);
      if (settings?.screenShareQuality !== quality) {
        void saveSettings({ screenShareQuality: quality }).catch(() => undefined);
      }
      localScreenShareActiveRef.current = true;
      setLocalScreenShareStream(stream);
      playUiSound("popup-open");
      pushToast({
        tone: "success",
        title: "屏幕分享已开启",
        description: stream.getAudioTracks().length
          ? "好友现在可以看到画面并听到系统声音。"
          : "好友现在可以看到画面；本次未捕获到系统声音。",
      });

      videoTrack.addEventListener(
        "ended",
        () => {
          if (screenShareStoppingRef.current) {
            return;
          }
          setLocalScreenShareStream(undefined);
          localScreenShareActiveRef.current = false;
          void stopScreenShare();
        },
        { once: true },
      );
    } catch (error) {
      await window.desktopApi.app.writeLog({
        category: "webrtc",
        level: "error",
        message: "Screen share request failed",
        context: {
          name: error instanceof DOMException ? error.name : undefined,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        pushToast({
          tone: "neutral",
          title: "已取消屏幕分享",
          description: "没有选择要分享的窗口。",
        });
        return;
      }

      requestedStream?.getTracks().forEach((track) => track.stop());
      pushToast({
        tone: "danger",
        title: "屏幕分享失败",
        description:
          error instanceof DOMException && error.name === "NotFoundError"
            ? "没有找到可分享的显示器或窗口。"
            : "桌面捕获没有启动，请重试；错误详情已经写入诊断日志。",
      });
    } finally {
      setIsScreenShareStarting(false);
    }
  };

  const openScreenSourcePicker = async () => {
    setIsScreenShareStarting(true);
    try {
      const sources = await window.desktopApi.screenCapture.listSources();
      if (!sources.length) {
        throw new Error("screen_source_missing");
      }
      setScreenCaptureSources(sources);
      setPendingScreenShareQuality(settings?.screenShareQuality ?? "720p");
      setIsScreenSourcePickerOpen(true);
    } catch (error) {
      await window.desktopApi.app.writeLog({
        category: "webrtc",
        level: "error",
        message: "Failed to enumerate screen capture sources",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
      pushToast({
        tone: "danger",
        title: "没有找到可分享的画面",
        description: "请确认 Windows 允许上号进行屏幕捕获后重试。",
      });
    } finally {
      setIsScreenShareStarting(false);
    }
  };

  const stopSharingScreen = async () => {
    screenShareStoppingRef.current = true;
    try {
      setLocalScreenShareStream(undefined);
      localScreenShareActiveRef.current = false;
      await stopScreenShare();
      playUiSound("popup-open");
      pushToast({
        tone: "neutral",
        title: "屏幕分享已停止",
        description: "好友不再看到你的屏幕。",
      });
    } finally {
      window.setTimeout(() => {
        screenShareStoppingRef.current = false;
      }, 0);
    }
  };

  const switchInputDevice = async (preferredInputDeviceId?: string) => {
    await saveSettings({ preferredInputDeviceId });
    await replaceInputDevice(preferredInputDeviceId);
    playUiSound("device-switch");
    pushToast({ tone: "success", title: "麦克风已切换", description: "新的输入设备已经生效。" });
  };

  const switchOutputDevice = async (preferredOutputDeviceId?: string) => {
    await saveSettings({ preferredOutputDeviceId });
    playUiSound("device-switch");
    pushToast({ tone: "success", title: "扬声器已切换", description: "新的输出设备已经生效。" });
  };

  const handleZoneSelect = (zone: SceneZoneId, activity: MemberActivity) => {
    if (isSeatZone(zone)) {
      lastSeatZoneRef.current = zone;
      const awaySession = awaySessionRef.current;
      const wasAway = Boolean(awaySession || localMember?.sceneZone === "restroomZone");
      awaySessionRef.current = undefined;
      if (wasAway) {
        setMuted(
          shouldMuteAfterAwayReturn({
            wasMuted: awaySession?.wasMuted ?? true,
            isDeafened,
          }),
        );
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
        wasMuted: useAudioStore.getState().isMuted,
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
    moveLocalMember(zone, activity);
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
        <TopStatusBar onKnock={() => void knock()} onInvite={() => void copyInviteLink()} />
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
            reactions={sceneReactions}
            knockPulse={chatMessages.filter((message) => message.id.startsWith("knock-")).length}
            reduceMotion={reduceMotion}
          />
          <ScreenSharePanel
            items={screenShareItems}
            onStopLocalShare={() => void stopSharingScreen()}
            onOpenDetached={async (item) => {
              try {
                await window.desktopApi.screenShareViewer.open(`上号 · ${item.title}`);
                setDetachedViewerId(item.id);
              } catch {
                setDetachedViewerId(undefined);
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
            canSend={canSend}
            unavailableLabel="正在重连..."
            reduceMotion={reduceMotion}
          />
        </div>
      </main>

      {isScreenSourcePickerOpen ? (
        <div
          className="screen-source-picker-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="选择要分享的画面"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setIsScreenSourcePickerOpen(false);
          }}
        >
          <section className="screen-source-picker-panel">
            <header>
              <div>
                <h2>分享哪个画面？</h2>
                <p>选择显示器或窗口。分享系统声音时请保持“系统音频”设置开启。</p>
              </div>
              <Button variant="ghost" onClick={() => setIsScreenSourcePickerOpen(false)}>
                取消
              </Button>
            </header>
            <div className="screen-source-quality" aria-label="屏幕分享画质">
              <span>画质</span>
              {(["720p", "1080p"] as const).map((quality) => (
                <button
                  key={quality}
                  type="button"
                  className={pendingScreenShareQuality === quality ? "active" : ""}
                  aria-pressed={pendingScreenShareQuality === quality}
                  onClick={() => setPendingScreenShareQuality(quality)}
                >
                  {quality}
                  <small>{quality === "720p" ? "流畅" : "清晰"}</small>
                </button>
              ))}
            </div>
            <div className="screen-source-picker-grid">
              {screenCaptureSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="screen-source-picker-item"
                  onClick={() => void startSharingScreen(source.id, pendingScreenShareQuality)}
                >
                  <span className="screen-source-thumbnail">
                    <img src={source.thumbnailDataUrl} alt="" draggable={false} />
                  </span>
                  <span className="screen-source-name">
                    {source.appIconDataUrl ? <img src={source.appIconDataUrl} alt="" /> : null}
                    <span>{source.name}</span>
                    <small>{source.kind === "screen" ? "显示器" : "窗口"}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

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
        <label className="device-select" data-icon-motion="device" title="选择麦克风">
          <AnimatedControlIcon name="headphones" className="h-4 w-4" />
          <select
            value={settings?.preferredInputDeviceId || ""}
            onChange={(event) => {
              const preferredInputDeviceId = event.target.value || undefined;
              void switchInputDevice(preferredInputDeviceId);
            }}
          >
            <option value="">默认麦克风</option>
            {inputDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label || "麦克风"}
              </option>
            ))}
          </select>
        </label>
        <label className="device-select" data-icon-motion="device" title="选择扬声器">
          <AnimatedControlIcon name="speaker" active className="h-4 w-4" />
          <select
            value={settings?.preferredOutputDeviceId || ""}
            onChange={(event) => void switchOutputDevice(event.target.value || undefined)}
          >
            <option value="">默认扬声器</option>
            {outputDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label || "扬声器"}
              </option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
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
          onClick={() => void leave()}
        >
          <AnimatedControlIcon name="exit" className="h-4 w-4" />
          <span className="voice-action-label">退出</span>
        </Button>
      </footer>
    </div>
  );
};
