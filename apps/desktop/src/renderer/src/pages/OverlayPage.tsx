import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MicOff, VolumeX, RotateCw } from "lucide-react";
import { gsap } from "gsap";

import { MemberPresenceState, MemberSpeakingState, type OverlayState } from "@private-voice/shared";

import { motionDuration, motionEase } from "../features/motion/motionSystem";
import { getAvatarFaceStyle, getAvatarSrc, getStableAvatarId } from "../utils/profile";

const AVATAR_SIZE = 24;
const GAP = 3;
const PADDING_X = 5;
const STATUS_WIDTH = 18;
const SHADOW_MARGIN = 0;
const PILL_HEIGHT = 32;
const MIN_PILL_WIDTH = 64;

export const OverlayPage = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<OverlayState>({
    members: [],
    isMuted: false,
    isDeafened: false,
    connectionState: "idle",
  });

  useEffect(() => window.desktopApi.overlay.onState(setState), []);

  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  const onlineMembers = state.members
    .filter((m) => !m.isEmptySlot)
    .sort((a, b) => {
      if (a.speakingState === MemberSpeakingState.Speaking) return -1;
      if (b.speakingState === MemberSpeakingState.Speaking) return 1;
      if (a.isLocal) return -1;
      if (b.isLocal) return 1;
      return 0;
    })
    .slice(0, 5);

  const count = onlineMembers.length;
  const visibleCount = count;
  const pillWidth = Math.max(
    MIN_PILL_WIDTH,
    PADDING_X * 2 +
      visibleCount * AVATAR_SIZE +
      Math.max(0, visibleCount - 1) * GAP +
      GAP +
      STATUS_WIDTH,
  );
  const windowWidth = pillWidth + SHADOW_MARGIN * 2;
  const windowHeight = PILL_HEIGHT + SHADOW_MARGIN * 2;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-overlay-pill], [data-overlay-avatar], [data-overlay-status]", {
          clearProps: "all",
        });
        return;
      }

      gsap.fromTo(
        "[data-overlay-pill]",
        { autoAlpha: 0, x: -5, scale: 0.94, filter: "blur(3px)" },
        {
          autoAlpha: 1,
          x: 0,
          scale: 1,
          filter: "blur(0px)",
          duration: motionDuration.message,
          ease: motionEase.spatial,
        },
      );
      gsap.fromTo(
        "[data-overlay-avatar]",
        { autoAlpha: 0, y: 3, scale: 0.86 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: motionDuration.feedback,
          ease: motionEase.spatial,
          stagger: 0.025,
        },
      );
      gsap.fromTo(
        "[data-overlay-status]",
        { autoAlpha: 0, x: -2 },
        {
          autoAlpha: 1,
          x: 0,
          duration: motionDuration.feedback,
          ease: motionEase.standard,
        },
      );
    }, root);

    return () => context.revert();
  }, [count, state.isDeafened, state.isMuted]);

  return (
    <div
      ref={rootRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: `${windowWidth}px`,
        height: `${windowHeight}px`,
        padding: `${SHADOW_MARGIN}px`,
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <div
        data-overlay-pill
        style={{
          width: `${pillWidth}px`,
          height: `${PILL_HEIGHT}px`,
          borderRadius: "999px",
          background: "linear-gradient(180deg, rgba(255,255,255,0.76), rgba(235,244,255,0.48))",
          border: "1px solid rgba(214, 226, 244, 0.74)",
          backdropFilter: "blur(18px) saturate(175%)",
          WebkitBackdropFilter: "blur(18px) saturate(175%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.90), inset 0 -1px 0 rgba(120,150,190,0.12)",
          display: "flex",
          alignItems: "center",
          gap: `${GAP}px`,
          padding: `0 ${PADDING_X}px`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: "1px 1px auto 1px",
            height: "40%",
            borderRadius: "999px",
            background: "linear-gradient(180deg, rgba(255,255,255,0.66), rgba(255,255,255,0))",
          }}
        />
        {onlineMembers.map((member) => {
          const avatarId = getStableAvatarId(member.id, member.avatarId);
          const isSpeaking = member.speakingState === MemberSpeakingState.Speaking;
          const isMuted = member.isMuted;
          const isDeafened = member.isDeafened;
          const isReconnecting = member.presenceState === MemberPresenceState.Reconnecting;
          const isOffline = member.presenceState === MemberPresenceState.Offline;

          return (
            <div
              key={member.id}
              data-overlay-avatar
              style={{
                position: "relative",
                width: `${AVATAR_SIZE}px`,
                height: `${AVATAR_SIZE}px`,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
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
                <img
                  src={getAvatarSrc(avatarId)}
                  alt=""
                  draggable={false}
                  style={{
                    ...getAvatarFaceStyle(avatarId),
                    filter: isMuted || isDeafened ? "saturate(0.5)" : "none",
                  }}
                />
              </div>
              {isMuted && !isDeafened && !isReconnecting && (
                <span
                  style={{
                    position: "absolute",
                    bottom: -1,
                    right: -1,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                  }}
                >
                  <MicOff className="h-[7px] w-[7px] text-[#FF5A5A]" />
                </span>
              )}
              {isDeafened && !isReconnecting && (
                <span
                  style={{
                    position: "absolute",
                    bottom: -1,
                    right: -1,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                  }}
                >
                  <VolumeX className="h-[7px] w-[7px] text-[#6366f1]" />
                </span>
              )}
              {isReconnecting && (
                <span
                  style={{
                    position: "absolute",
                    bottom: -1,
                    right: -1,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                  }}
                >
                  <RotateCw className="h-[7px] w-[7px] text-[#F59E0B] animate-spin" />
                </span>
              )}
            </div>
          );
        })}
        <span
          data-overlay-status
          style={{
            zIndex: 1,
            marginLeft: "auto",
            width: `${STATUS_WIDTH}px`,
            height: "17px",
            borderRadius: "999px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: state.isMuted ? "#FF5A5A" : state.isDeafened ? "#6366F1" : "#2F6FCC",
            background: state.isMuted
              ? "rgba(255,90,90,0.12)"
              : state.isDeafened
                ? "rgba(99,102,241,0.12)"
                : "rgba(77,163,255,0.12)",
            border: "1px solid rgba(255,255,255,0.62)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.72)",
            fontSize: "9px",
            fontWeight: 700,
          }}
        >
          {state.isMuted ? (
            <MicOff className="h-2.5 w-2.5" />
          ) : state.isDeafened ? (
            <VolumeX className="h-2.5 w-2.5" />
          ) : (
            `${count}/5`
          )}
        </span>
      </div>
    </div>
  );
};
