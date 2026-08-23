import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AudioLines,
  Circle,
  GripVertical,
  MicOff,
  MonitorUp,
  RotateCcw,
  RotateCw,
  VolumeX,
} from "lucide-react";
import { gsap } from "gsap";

import { MemberPresenceState, MemberSpeakingState, type OverlayState } from "@private-voice/shared";

import { motionDuration, motionEase } from "../features/motion/motionSystem";
import {
  getAvatarEmoji,
  getAvatarFaceStyle,
  getAvatarSrc,
  getStableAvatarId,
} from "../utils/profile";

const OVERLAY_WIDTH = 142;
const AVATAR_SIZE = 26;
const ROW_HEIGHT = 36;
const GAP = 4;
const PADDING = 5;
const TOOLS_REVEAL_SECONDS = 1;
const POINTER_STILL_THRESHOLD = 3;

const OverlayAvatar = ({
  memberId,
  nickname,
  avatarId,
  dimmed,
}: {
  memberId: string;
  nickname: string;
  avatarId: ReturnType<typeof getStableAvatarId>;
  dimmed: boolean;
}) => {
  const source = getAvatarSrc(avatarId);
  const [loadedSource, setLoadedSource] = useState<string>();
  const isLoaded = loadedSource === source;

  useEffect(() => {
    setLoadedSource(undefined);
  }, [memberId, source]);

  return (
    <>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontSize: 17,
          lineHeight: 1,
          opacity: isLoaded ? 0 : 1,
        }}
      >
        {getAvatarEmoji(avatarId)}
      </span>
      <img
        src={source}
        alt={nickname}
        draggable={false}
        onLoad={() => setLoadedSource(source)}
        onError={() => setLoadedSource(undefined)}
        style={{
          ...getAvatarFaceStyle(avatarId),
          opacity: isLoaded ? 1 : 0,
          filter: dimmed ? "saturate(0.5)" : "none",
        }}
      />
    </>
  );
};

export const OverlayPage = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<SVGRectElement>(null);
  const progressTweenRef = useRef<gsap.core.Tween | undefined>(undefined);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const lastPointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const dragPointerOffsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const toolsVisibleRef = useRef(false);
  const [toolsVisible, setToolsVisible] = useState(false);
  const [isHoverArming, setIsHoverArming] = useState(false);
  const [state, setState] = useState<OverlayState>({
    members: [],
    isMuted: false,
    isDeafened: false,
    connectionState: "idle",
    isRecording: false,
    isScreenSharing: false,
    hasSystemAudio: false,
  });

  useEffect(() => window.desktopApi.overlay.onState(setState), []);

  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  useEffect(
    () => () => {
      progressTweenRef.current?.kill();
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      void window.desktopApi.overlay.setInteractive(false);
    },
    [],
  );

  const revealTools = useCallback(() => {
    setIsHoverArming(false);
    toolsVisibleRef.current = true;
    setToolsVisible(true);
    void window.desktopApi.overlay.setInteractive(true);
  }, []);

  const startRevealProgress = useCallback(() => {
    const progress = progressRef.current;
    if (!progress || toolsVisibleRef.current || isDraggingRef.current) return;
    progressTweenRef.current?.kill();
    setIsHoverArming(true);
    // Keep a short visible head on the first frame. A mathematically empty
    // dash looks like nothing happened even though the timer has started.
    gsap.set(progress, { attr: { strokeDashoffset: 98 }, opacity: 1 });
    progressTweenRef.current = gsap.to(progress, {
      attr: { strokeDashoffset: 0 },
      duration: TOOLS_REVEAL_SECONDS,
      ease: "none",
      onComplete: () => {
        gsap.to(progress, { opacity: 0, duration: 0.18, ease: "power2.out" });
        revealTools();
      },
    });
  }, [revealTools]);

  const cancelRevealProgress = useCallback(() => {
    progressTweenRef.current?.kill();
    progressTweenRef.current = undefined;
    setIsHoverArming(false);
    if (progressRef.current) {
      gsap.set(progressRef.current, { attr: { strokeDashoffset: 100 }, opacity: 0 });
    }
  }, []);

  const armStationaryTools = (event: React.MouseEvent<HTMLDivElement>) => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (toolsVisibleRef.current || isDraggingRef.current) return;
    const previous = lastPointerRef.current;
    const next = { x: event.screenX, y: event.screenY };
    if (!previous) {
      lastPointerRef.current = next;
      startRevealProgress();
      return;
    }
    if (Math.hypot(next.x - previous.x, next.y - previous.y) >= POINTER_STILL_THRESHOLD) {
      lastPointerRef.current = next;
      startRevealProgress();
    }
  };

  const hideTools = useCallback(() => {
    if (isDraggingRef.current) return;
    cancelRevealProgress();
    lastPointerRef.current = undefined;
    toolsVisibleRef.current = false;
    setToolsVisible(false);
    void window.desktopApi.overlay.setInteractive(false);
  }, [cancelRevealProgress]);

  const scheduleHideTools = useCallback(() => {
    if (isDraggingRef.current) return;
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = undefined;
      hideTools();
    }, 220);
  }, [hideTools]);

  const keepToolsOpen = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
    if (!toolsVisibleRef.current && !isDraggingRef.current) startRevealProgress();
  }, [startRevealProgress]);

  useEffect(
    () =>
      window.desktopApi.overlay.onHoverState((inside) => {
        if (inside) {
          keepToolsOpen();
          return;
        }
        scheduleHideTools();
      }),
    [keepToolsOpen, scheduleHideTools],
  );

  const finishDrag = (target?: HTMLButtonElement, pointerId?: number) => {
    isDraggingRef.current = false;
    if (target && typeof pointerId === "number" && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  };

  const showToolsImmediately = () => {
    cancelRevealProgress();
    if (!toolsVisibleRef.current) {
      setToolsVisible(true);
      toolsVisibleRef.current = true;
      void window.desktopApi.overlay.setInteractive(true);
    }
  };

  const onlineMembers = state.members.filter((m) => !m.isEmptySlot).slice(0, 5);
  const onlineMemberIds = onlineMembers.map((member) => member.id).join("|");

  const count = onlineMembers.length;
  const visibleCount = Math.max(1, count);
  const windowHeight = PADDING * 2 + visibleCount * ROW_HEIGHT + (visibleCount - 1) * GAP;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-overlay-list]",
        { autoAlpha: 0, x: -8 },
        {
          autoAlpha: 1,
          x: 0,
          duration: motionDuration.message,
          ease: motionEase.spatial,
        },
      );
      gsap.fromTo(
        "[data-overlay-row]",
        { autoAlpha: 0, x: -7 },
        {
          autoAlpha: 1,
          x: 0,
          duration: motionDuration.feedback,
          ease: motionEase.spatial,
          stagger: 0.035,
        },
      );
    }, root);

    return () => context.revert();
  }, [onlineMemberIds]);

  return (
    <div
      ref={rootRef}
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={armStationaryTools}
      onMouseEnter={keepToolsOpen}
      onMouseLeave={scheduleHideTools}
      style={{
        width: `${OVERLAY_WIDTH}px`,
        height: `${windowHeight}px`,
        padding: `${PADDING}px`,
        background: "transparent",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-start",
        position: "relative",
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      <svg
        className={`overlay-still-progress ${isHoverArming ? "is-arming" : ""}`}
        viewBox={`0 0 ${OVERLAY_WIDTH} ${windowHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect
          className="overlay-still-progress-track"
          x="2"
          y="2"
          width={OVERLAY_WIDTH - 4}
          height={Math.max(1, windowHeight - 4)}
          rx="13"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset="0"
        />
        <rect
          className="overlay-still-progress-value"
          ref={progressRef}
          x="2"
          y="2"
          width={OVERLAY_WIDTH - 4}
          height={Math.max(1, windowHeight - 4)}
          rx="13"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset="100"
        />
      </svg>
      <div
        data-overlay-list
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: `${GAP}px`,
          position: "relative",
        }}
      >
        {onlineMembers.map((member) => {
          const avatarId = getStableAvatarId(member.id, member.avatarId);
          const isSpeaking = member.speakingState === MemberSpeakingState.Speaking;
          const isMuted = member.isMuted;
          const isDeafened = member.isDeafened;
          const isReconnecting = member.presenceState === MemberPresenceState.Reconnecting;
          const isOffline = member.presenceState === MemberPresenceState.Offline;
          const statusColor = isReconnecting
            ? "#F59E0B"
            : isOffline
              ? "#98A2B3"
              : isDeafened
                ? "#6366F1"
                : isMuted
                  ? "#E5484D"
                  : isSpeaking
                    ? "#21B877"
                    : "#A8B6C8";
          const statusSurface = isReconnecting
            ? {
                background:
                  "linear-gradient(180deg, rgba(255,249,231,0.94), rgba(255,241,204,0.84))",
                border: "rgba(245,158,11,0.48)",
              }
            : isOffline
              ? {
                  background:
                    "linear-gradient(180deg, rgba(247,249,252,0.92), rgba(232,237,244,0.82))",
                  border: "rgba(152,162,179,0.42)",
                }
              : isDeafened
                ? {
                    background:
                      "linear-gradient(180deg, rgba(242,242,255,0.94), rgba(228,229,255,0.84))",
                    border: "rgba(99,102,241,0.46)",
                  }
                : isMuted
                  ? {
                      background:
                        "linear-gradient(180deg, rgba(255,244,245,0.95), rgba(255,226,229,0.86))",
                      border: "rgba(229,72,77,0.46)",
                    }
                  : isSpeaking
                    ? {
                        background:
                          "linear-gradient(180deg, rgba(240,255,249,0.96), rgba(218,247,235,0.86))",
                        border: "rgba(33,184,119,0.5)",
                      }
                    : {
                        background:
                          "linear-gradient(180deg, rgba(255,255,255,0.88), rgba(235,244,255,0.72))",
                        border: "rgba(168,182,200,0.42)",
                      };
          const localActivityFlags = member.isLocal
            ? [
                state.isRecording
                  ? { key: "recording", title: "正在录音", Icon: Circle, color: "#E5484D" }
                  : undefined,
                state.isScreenSharing
                  ? { key: "screen", title: "正在分享屏幕", Icon: MonitorUp, color: "#2F80ED" }
                  : undefined,
                state.hasSystemAudio
                  ? {
                      key: "system-audio",
                      title: "正在分享系统音频",
                      Icon: AudioLines,
                      color: "#21A66D",
                    }
                  : undefined,
              ]
                .filter((flag): flag is NonNullable<typeof flag> => Boolean(flag))
                .slice(0, 2)
            : [];

          return (
            <div
              key={member.id}
              data-overlay-row
              style={{
                position: "relative",
                width: "100%",
                height: `${ROW_HEIGHT}px`,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 8px 4px 5px",
                borderRadius: 12,
                background: statusSurface.background,
                border: `1px solid ${statusSurface.border}`,
                backdropFilter: "blur(14px) saturate(155%)",
                WebkitBackdropFilter: "blur(14px) saturate(155%)",
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.92), 0 3px 12px ${statusColor}24`,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: AVATAR_SIZE,
                  height: AVATAR_SIZE,
                  flexShrink: 0,
                  borderRadius: "50%",
                  overflow: "hidden",
                  background: "rgba(255,255,255,0.88)",
                  border: isSpeaking
                    ? "1.5px solid rgba(77, 163, 255, 0.70)"
                    : "1px solid rgba(255, 255, 255, 0.82)",
                  boxShadow: isSpeaking
                    ? "0 0 0 2px rgba(77, 163, 255, 0.13), 0 0 10px rgba(77, 163, 255, 0.36), 0 2px 5px rgba(30, 45, 70, 0.10)"
                    : "0 2px 5px rgba(30, 45, 70, 0.10)",
                  opacity: isOffline ? 0.5 : 1,
                  transition:
                    "border-color 220ms cubic-bezier(0.16,1,0.3,1), box-shadow 220ms cubic-bezier(0.16,1,0.3,1), opacity 160ms linear",
                }}
              >
                <OverlayAvatar
                  memberId={member.id}
                  nickname={member.nickname}
                  avatarId={avatarId}
                  dimmed={Boolean(isMuted || isDeafened)}
                />
              </div>
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                  color: isOffline ? "#8290A3" : "#31435B",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: onlineMembers.length === 1 ? 1.1 : 1,
                  whiteSpace: onlineMembers.length === 1 ? "normal" : "nowrap",
                  overflow: onlineMembers.length === 1 ? "visible" : "hidden",
                  textOverflow: onlineMembers.length === 1 ? "clip" : "ellipsis",
                }}
              >
                {member.nickname || "好友"}
              </span>
              {localActivityFlags.map(({ key, title, Icon, color }) => (
                <span
                  key={key}
                  title={title}
                  aria-label={title}
                  style={{ display: "inline-flex", color, flexShrink: 0 }}
                >
                  <Icon
                    className="h-2.5 w-2.5"
                    fill={key === "recording" ? "currentColor" : "none"}
                  />
                </span>
              ))}
              {isMuted && !isDeafened && !isReconnecting && !isOffline && (
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "rgba(255,90,90,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                  }}
                >
                  <MicOff className="h-2.5 w-2.5 text-[#FF5A5A]" />
                </span>
              )}
              {isDeafened && !isReconnecting && !isOffline && (
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "rgba(99,102,241,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                  }}
                >
                  <VolumeX className="h-2.5 w-2.5 text-[#6366f1]" />
                </span>
              )}
              {isReconnecting && !isOffline && (
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "rgba(245,158,11,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                  }}
                >
                  <RotateCw className="h-2.5 w-2.5 text-[#F59E0B] animate-spin" />
                </span>
              )}
              {!isMuted && !isDeafened && !isReconnecting && localActivityFlags.length === 0 && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    flexShrink: 0,
                    borderRadius: "50%",
                    background: statusColor,
                    boxShadow: isSpeaking ? "0 0 0 3px rgba(33,184,119,0.14)" : "none",
                    transition:
                      "background-color 160ms linear, box-shadow 200ms cubic-bezier(0.16,1,0.3,1)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div
        className={`overlay-position-tools ${toolsVisible ? "is-visible" : ""}`}
        aria-hidden={!toolsVisible}
      >
        <button
          type="button"
          aria-label="上下移动悬浮窗"
          title="上下移动"
          onPointerDown={(event) => {
            isDraggingRef.current = true;
            showToolsImmediately();
            dragPointerOffsetRef.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
            void window.desktopApi.overlay.moveTo(event.screenY - dragPointerOffsetRef.current);
          }}
          onPointerMove={(event) => {
            if (isDraggingRef.current) {
              void window.desktopApi.overlay.moveTo(event.screenY - dragPointerOffsetRef.current);
            }
          }}
          onPointerUp={(event) => {
            finishDrag(event.currentTarget, event.pointerId);
          }}
          onPointerCancel={(event) => finishDrag(event.currentTarget, event.pointerId)}
        >
          <GripVertical aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="恢复悬浮窗默认位置"
          title="恢复默认位置"
          onClick={() => {
            showToolsImmediately();
            void window.desktopApi.overlay.resetPosition();
          }}
        >
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
