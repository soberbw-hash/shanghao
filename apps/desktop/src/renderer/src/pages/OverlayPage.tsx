import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MicOff, VolumeX, RotateCw } from "lucide-react";
import { gsap } from "gsap";

import { MemberPresenceState, MemberSpeakingState, type OverlayState } from "@private-voice/shared";

import { getAvatarSrc } from "../utils/profile";

const AVATAR_SIZE = 28;
const GAP = 4;
const PADDING_X = 8;
const STATUS_WIDTH = 24;
const SHADOW_MARGIN = 0;
const PILL_HEIGHT = 38;
const MIN_PILL_WIDTH = 88;

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
  const visibleCount = Math.max(1, count);
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
        gsap.set("[data-overlay-pill], [data-overlay-avatar], [data-overlay-status]", { clearProps: "all" });
        return;
      }

      gsap.fromTo(
        "[data-overlay-pill]",
        { autoAlpha: 0, x: -8, scale: 0.92, filter: "blur(4px)" },
        { autoAlpha: 1, x: 0, scale: 1, filter: "blur(0px)", duration: 0.36, ease: "back.out(1.55)" },
      );
      gsap.fromTo(
        "[data-overlay-avatar]",
        { autoAlpha: 0, y: 4, scale: 0.82 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.28, ease: "back.out(1.8)", stagger: 0.035 },
      );
      gsap.fromTo(
        "[data-overlay-status]",
        { autoAlpha: 0, x: -3 },
        { autoAlpha: 1, x: 0, duration: 0.22, ease: "power3.out" },
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
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.76), rgba(235,244,255,0.48))",
          border: "1px solid rgba(214, 226, 244, 0.74)",
          backdropFilter: "blur(24px) saturate(185%)",
          WebkitBackdropFilter: "blur(24px) saturate(185%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.90), inset 0 -1px 0 rgba(120,150,190,0.12)",
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
            height: "42%",
            borderRadius: "999px",
            background: "linear-gradient(180deg, rgba(255,255,255,0.66), rgba(255,255,255,0))",
          }}
        />
        {onlineMembers.length === 0 ? (
          <span
            data-overlay-avatar
            style={{
              width: `${AVATAR_SIZE}px`,
              height: `${AVATAR_SIZE}px`,
              borderRadius: "999px",
              background: "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(233,241,252,0.8))",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.78), 0 2px 7px rgba(30,45,70,0.08)",
            }}
          />
        ) : null}
        {onlineMembers.map((member) => {
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
                border: isSpeaking ? "2px solid rgba(77, 163, 255, 0.70)" : "1px solid rgba(255, 255, 255, 0.82)",
                boxShadow: isSpeaking
                  ? "0 0 0 3px rgba(77, 163, 255, 0.13), 0 0 14px rgba(77, 163, 255, 0.42), 0 2px 7px rgba(30, 45, 70, 0.10)"
                  : "0 2px 7px rgba(30, 45, 70, 0.10)",
                opacity: isOffline ? 0.5 : 1,
                transition: "all 300ms ease",
              }}
            >
              <img
                src={getAvatarSrc(member.avatarId)}
                alt=""
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  transform: "scale(1.18) translateY(1px)",
                  filter: isMuted || isDeafened ? "saturate(0.5)" : "none",
                }}
              />
            </div>
            {member.isLocal && isMuted && (
              <span
                style={{
                  position: "absolute",
                  bottom: -2,
                  right: -2,
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                }}
              >
                <MicOff className="h-2 w-2 text-[#FF5A5A]" />
              </span>
            )}
            {member.isLocal && isDeafened && (
              <span
                style={{
                  position: "absolute",
                  bottom: -2,
                  right: -2,
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                }}
              >
                <VolumeX className="h-2 w-2 text-[#6366f1]" />
              </span>
            )}
            {isReconnecting && (
              <span
                style={{
                  position: "absolute",
                  bottom: -2,
                  right: -2,
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  background: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                }}
              >
                <RotateCw className="h-2 w-2 text-[#F59E0B] animate-spin" />
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
            height: "22px",
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
          {state.isMuted ? <MicOff className="h-3 w-3" /> : state.isDeafened ? <VolumeX className="h-3 w-3" /> : `${Math.max(1, count)}/5`}
        </span>
      </div>
    </div>
  );
};
