import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  GripHorizontal,
  BookmarkPlus,
  Headphones,
  LogOut,
  Maximize2,
  Minimize2,
  MonitorUp,
  PictureInPicture2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { gsap } from "gsap";

import {
  RecordingEncoderState,
  RecordingState,
  MemberSpeakingState,
  RoomConnectionState,
  type GameDetectionSnapshot,
  type MemberActivity,
  type SceneZoneId,
  type ScreenShareQuality,
} from "@private-voice/shared";
import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";

import { MuteButton } from "../components/audio/MuteButton";
import { RecordingButton } from "../components/audio/RecordingButton";
import { Button } from "../components/base/Button";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { TeamIsland } from "../components/room/TeamIsland";
import { playUiSound } from "../features/audio/uiSound";
import { chatWithLLM, shouldCallLLM, type LlmHistoryEntry } from "../features/chat/llmService";
import { motionDuration, motionEase } from "../features/motion/motionSystem";
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
const SCREEN_SHARE_PROFILES: Record<
  ScreenShareQuality,
  ScreenShareEncodingProfile
> = {
  smooth: {
    maxBitrate: 420_000,
    maxFramerate: 15,
    maxWidth: 1_280,
    maxHeight: 720,
  },
  balanced: {
    maxBitrate: 680_000,
    maxFramerate: 20,
    maxWidth: 1_600,
    maxHeight: 900,
  },
  clear: {
    maxBitrate: 1_050_000,
    maxFramerate: 24,
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

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="screen-share-video"
    />
  );
};

const ScreenShareMedia = ({ item }: { item: ScreenShareItem }) => {
  if (item.stream) {
    return <ScreenShareVideo stream={item.stream} />;
  }

  return (
    <img
      src={item.frameDataUrl}
      alt=""
      className="screen-share-video"
      draggable={false}
    />
  );
};

const ScreenSharePanel = ({
  items,
  onStopLocalShare,
  isExpanded,
  onToggleExpanded,
}: {
  items: ScreenShareItem[];
  onStopLocalShare: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string>();
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
    if (isExpanded || (event.target as Element).closest("button")) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: position.x,
      baseY: position.y,
    };
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
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={panelRef}
      className={`screen-share-panel ${isExpanded ? "screen-share-panel-expanded" : ""}`}
      data-testid="screen-share-panel"
      style={
        isExpanded
          ? undefined
          : { transform: `translate3d(${position.x}px, ${position.y}px, 0)` }
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
            onClick={onToggleExpanded}
            title={isExpanded ? "缩小屏幕分享" : "放大屏幕分享"}
            aria-label={isExpanded ? "缩小屏幕分享" : "放大屏幕分享"}
          >
            {isExpanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
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
    updateRoomNote,
    replaceInputDevice,
    copyInviteLink,
    moveLocalMember,
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
  const { inputDevices, outputDevices, isMuted, isDeafened, toggleMute, toggleDeafen } = useAudioStore();
  const recordingStatus = useRecordingStore((state) => state.status);
  const recordingMarkers = useRecordingStore((state) => state.markers);
  const addRecordingMarker = useRecordingStore((state) => state.addMarker);
  const clearRecordingMarkers = useRecordingStore((state) => state.clearMarkers);
  const { capability, startRecording, stopRecording } = useRecordingController();
  const pageRef = useRef<HTMLDivElement>(null);
  const voicePulseRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [isLLMLoading, setIsLLMLoading] = useState(false);
  const [localScreenShareStream, setLocalScreenShareStream] = useState<MediaStream>();
  const [isScreenShareStarting, setIsScreenShareStarting] = useState(false);
  const [isScreenShareExpanded, setIsScreenShareExpanded] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const lastSpokeAtRef = useRef(Date.now());
  const lastSeatZoneRef = useRef<SceneZoneId>("gameDesk1");
  const lastKnockAt = useRef(0);
  const detectedGameRef = useRef<string>();
  const screenShareStoppingRef = useRef(false);
  const localScreenShareActiveRef = useRef(false);
  const moveLocalMemberRef = useRef(moveLocalMember);
  moveLocalMemberRef.current = moveLocalMember;
  const llmHistoryRef = useRef<LlmHistoryEntry[]>([]);
  const reduceMotion = usePrefersReducedMotion(settings?.reduceMotion ?? false);

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

  useEffect(() => {
    if (screenShareItems.length === 0) {
      setIsScreenShareExpanded(false);
    }
  }, [screenShareItems.length]);

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
          duration: 0.26,
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
    if (localMember.speakingState === MemberSpeakingState.Speaking) {
      lastSpokeAtRef.current = Date.now();
      if (localMember.sceneZone === "restroomZone") {
        moveLocalMemberRef.current(
          lastSeatZoneRef.current,
          localMember.gameName ? "gaming" : "idle",
          localMember.gameName,
        );
      }
    }
  }, [
    localMember?.gameName,
    localMember?.sceneZone,
    localMember?.speakingState,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentLocalMember = useRoomStore
        .getState()
        .room.members.find((member) => member.isLocal);
      if (
        currentLocalMember &&
        currentLocalMember.sceneZone !== "restroomZone" &&
        !currentLocalMember.gameName &&
        !localScreenShareActiveRef.current &&
        Date.now() - lastSpokeAtRef.current >= 5 * 60_000
      ) {
        moveLocalMemberRef.current("restroomZone", "restroom");
        void window.desktopApi.app.writeLog({
          category: "app",
          level: "info",
          message: "Moved local member to away zone after five minutes of silence",
        });
        pushToast({
          tone: "neutral",
          title: "已切到离开一下",
          description: "5 分钟没有说话，开麦后会自动回到座位。",
        });
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const applyGameDetection = (snapshot: GameDetectionSnapshot) => {
      const previousGame = detectedGameRef.current;
      detectedGameRef.current = snapshot.gameName;
      const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
      const currentZone = localMember?.sceneZone ?? "gameDesk1";

      if (snapshot.gameName) {
        const gameZone = currentZone.startsWith("gameDesk") ? currentZone : "gameDesk1";
        moveLocalMemberRef.current(gameZone, "gaming", snapshot.gameName);
      } else if (previousGame) {
        moveLocalMemberRef.current(currentZone, "idle");
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

    if (shouldCallLLM(content) && !isLLMLoading) {
      setIsLLMLoading(true);
      const { addChatMessage } = useRoomStore.getState();
      const placeholderId = "llm-thinking-" + Date.now();

      addChatMessage({
        id: placeholderId,
        peerId: "llm-assistant",
        nickname: "上号",
        content: "上号正在想…",
        createdAt: new Date().toISOString(),
        isLocal: false,
        kind: "chat",
        isBot: true,
      });

      try {
        const reply = await chatWithLLM(content, llmHistoryRef.current);
        llmHistoryRef.current.push(
          { role: "user", content },
          { role: "assistant", content: reply },
        );
        if (llmHistoryRef.current.length > 20) {
          llmHistoryRef.current.splice(0, llmHistoryRef.current.length - 20);
        }

        const { replaceChatMessage } = useRoomStore.getState();
        replaceChatMessage(placeholderId, reply);
      } catch {
        const { replaceChatMessage } = useRoomStore.getState();
        replaceChatMessage(placeholderId, "助手没接通，稍后再试。");
      } finally {
        setIsLLMLoading(false);
      }
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
    await sendKnock();
  };

  const toggleRecording = async () => {
    try {
      if (recordingStatus.state === RecordingState.Recording) {
        const result = await stopRecording();
        if (recordingMarkers.length) {
          await window.desktopApi.recording.saveMarkers(
            result.filePath,
            recordingMarkers,
          );
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

  const startSharingScreen = async () => {
    let requestedStream: MediaStream | undefined;
    setIsScreenShareStarting(true);
    try {
      const quality = settings?.screenShareQuality ?? "smooth";
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
      lastSpokeAtRef.current = Date.now();
    }
    moveLocalMember(zone, activity);
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

      <main className="grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[minmax(0,1.44fr)_minmax(280px,.56fr)]">
        <section data-gsap-room="island" className="island-panel min-h-0 overflow-hidden">
          <TeamIsland
            members={room.members}
            onZoneSelect={handleZoneSelect}
            onReact={(targetPeerId, emoji) => void sendSceneReaction(targetPeerId, emoji)}
            reactions={sceneReactions}
            roomNote={room.roomNote}
            onRoomNoteChange={(content) => void updateRoomNote(content)}
            knockPulse={chatMessages.filter((message) => message.kind === "system").length}
            reduceMotion={settings?.reduceMotion ?? false}
          />
          <ScreenSharePanel
            items={screenShareItems}
            onStopLocalShare={() => void stopSharingScreen()}
            isExpanded={isScreenShareExpanded}
            onToggleExpanded={() => setIsScreenShareExpanded((current) => !current)}
          />
        </section>
        <div data-gsap-room="chat" className="min-h-0">
          <TemporaryChatPanel
            className="h-full"
            messages={chatMessages}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onSend={() => void send()}
            onQuickSend={(message) => void send(message)}
            canSend={canSend}
            unavailableLabel="正在重连..."
            reduceMotion={settings?.reduceMotion ?? false}
          />
        </div>
      </main>

      <footer ref={voicePulseRef} data-gsap-room="dock" className="voice-dock flex items-center gap-2 px-3 py-2.5">
        <span data-gsap-voice="primary" className="inline-flex">
          <MuteButton isMuted={isMuted} onClick={toggleMute} />
        </span>
        <Button
          variant={isDeafened ? "danger" : "ghost"}
          data-gsap-voice="primary"
          className={`voice-action-button-with-text voice-main-control ${isDeafened ? "voice-main-control-danger" : ""}`}
          onClick={toggleDeafen}
        >
          {isDeafened ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          <span className="voice-action-label">{isDeafened ? "扬声器关" : "扬声器开"}</span>
        </Button>
        <label className="device-select" title="选择麦克风">
          <Headphones className="h-4 w-4" />
          <select
            value={settings?.preferredInputDeviceId || ""}
            onChange={(event) => {
              const preferredInputDeviceId = event.target.value || undefined;
              void switchInputDevice(preferredInputDeviceId);
            }}
          >
            <option value="">默认麦克风</option>
            {inputDevices.map((device) => (
              <option key={device.id} value={device.id}>{device.label || "麦克风"}</option>
            ))}
          </select>
        </label>
        <label className="device-select" title="选择扬声器">
          <Volume2 className="h-4 w-4" />
          <select
            value={settings?.preferredOutputDeviceId || ""}
            onChange={(event) => void switchOutputDevice(event.target.value || undefined)}
          >
            <option value="">默认扬声器</option>
            {outputDevices.map((device) => (
              <option key={device.id} value={device.id}>{device.label || "扬声器"}</option>
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
            <BookmarkPlus className="h-4 w-4" />
            <span className="voice-action-label">标记 {recordingMarkers.length}</span>
          </Button>
        ) : null}
        <Button
          variant={localScreenShareStream ? "secondary" : "ghost"}
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
            void startSharingScreen();
          }}
        >
          <MonitorUp className="h-4 w-4" />
          <span className="voice-action-label">
            {isScreenShareStarting
              ? "正在开启…"
              : localScreenShareStream
                ? "正在分享"
                : "屏幕分享"}
          </span>
        </Button>
        <Button
          variant={isOverlayOpen ? "secondary" : "ghost"}
          className={`voice-action-button-with-text ${isOverlayOpen ? "overlay-active-button" : ""}`}
          onClick={() => {
            playUiSound("popup-open");
            void window.desktopApi.overlay.toggle().then(setIsOverlayOpen);
          }}
        >
          <PictureInPicture2 className="h-4 w-4" />
          <span className="voice-action-label">{isOverlayOpen ? "悬浮窗开" : "悬浮窗关"}</span>
        </Button>
        <Button
          variant="danger"
          className="voice-action-button-with-text voice-exit-button"
          onClick={() => void leave()}
        >
          <LogOut className="h-4 w-4" />
          <span className="voice-action-label">退出</span>
        </Button>
      </footer>

    </div>
  );
};
