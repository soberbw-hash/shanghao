import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MicOff, RotateCw, VolumeX } from "lucide-react";
import { gsap } from "gsap";

import { MemberPresenceState, MemberSpeakingState, type OverlayState } from "@private-voice/shared";

import { motionDuration, motionEase } from "../features/motion/motionSystem";
import { getAvatarFaceStyle, getAvatarSrc, getStableAvatarId } from "../utils/profile";

const OVERLAY_WIDTH = 142;
const AVATAR_SIZE = 26;
const ROW_HEIGHT = 36;
const GAP = 4;
const PADDING = 5;

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

  const onlineMembers = state.members.filter((m) => !m.isEmptySlot).slice(0, 5);
  const onlineMemberIds = onlineMembers.map((member) => member.id).join("|");

  const count = onlineMembers.length;
  const visibleCount = Math.max(1, count);
  const windowHeight = PADDING * 2 + visibleCount * ROW_HEIGHT + (visibleCount - 1) * GAP;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-overlay-list], [data-overlay-row]", {
          clearProps: "all",
        });
        return;
      }

      gsap.fromTo(
        "[data-overlay-list]",
        { autoAlpha: 0, x: -8, scale: 0.96 },
        {
          autoAlpha: 1,
          x: 0,
          scale: 1,
          duration: motionDuration.message,
          ease: motionEase.spatial,
        },
      );
      gsap.fromTo(
        "[data-overlay-row]",
        { autoAlpha: 0, x: -7, scale: 0.97 },
        {
          autoAlpha: 1,
          x: 0,
          scale: 1,
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
      style={{
        width: `${OVERLAY_WIDTH}px`,
        height: `${windowHeight}px`,
        padding: `${PADDING}px`,
        background: "transparent",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-start",
        position: "relative",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
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
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.82), rgba(235,244,255,0.66))",
                border: isSpeaking
                  ? "1px solid rgba(55, 188, 126, 0.58)"
                  : isMuted || isDeafened
                    ? "1px solid rgba(255, 90, 90, 0.45)"
                    : "1px solid rgba(214, 226, 244, 0.80)",
                backdropFilter: "blur(14px) saturate(155%)",
                WebkitBackdropFilter: "blur(14px) saturate(155%)",
                boxShadow: isSpeaking
                  ? "inset 0 1px 0 rgba(255,255,255,0.92), 0 3px 12px rgba(34, 177, 112, 0.16)"
                  : isMuted || isDeafened
                    ? "inset 0 1px 0 rgba(255,255,255,0.92), 0 3px 12px rgba(255, 90, 90, 0.13)"
                    : "inset 0 1px 0 rgba(255,255,255,0.92), 0 3px 10px rgba(47, 79, 120, 0.10)",
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
              <span
                style={{
                  minWidth: 0,
                  flex: 1,
                  color: isMuted || isDeafened ? "#C83F4A" : "#31435B",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {member.nickname || "好友"}
              </span>
              {isMuted && !isDeafened && !isReconnecting && (
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
              {isDeafened && !isReconnecting && (
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
              {isReconnecting && (
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
              {!isMuted && !isDeafened && !isReconnecting && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    flexShrink: 0,
                    borderRadius: "50%",
                    background: isSpeaking ? "#21B877" : "#A8B6C8",
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
    </div>
  );
};
