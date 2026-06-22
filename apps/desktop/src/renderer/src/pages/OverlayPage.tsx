import { useEffect, useState } from "react";
import { MicOff, VolumeX, RotateCw } from "lucide-react";

import { MemberPresenceState, MemberSpeakingState, type OverlayState } from "@private-voice/shared";

import { getAvatarSrc } from "../utils/profile";

export const OverlayPage = () => {
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
  const avatarSize = 30;
  const gap = 5;
  const padding = 5;
  const width = Math.max(48, padding * 2 + Math.max(1, count) * avatarSize + Math.max(0, count - 1) * gap);

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: `${width}px`,
        height: `${padding * 2 + avatarSize}px`,
        borderRadius: "999px",
        background: "linear-gradient(180deg, rgba(255,255,255,0.66), rgba(245,249,255,0.34))",
        border: "1px solid rgba(209, 224, 244, 0.72)",
        backdropFilter: "blur(24px) saturate(180%)",
        WebkitBackdropFilter: "blur(24px) saturate(180%)",
        boxShadow: "0 10px 28px rgba(45, 82, 126, 0.16), 0 2px 8px rgba(45, 82, 126, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: `${gap}px`,
        padding: `${padding}px`,
        position: "relative",
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {onlineMembers.map((member) => {
        const isSpeaking = member.speakingState === MemberSpeakingState.Speaking;
        const isMuted = member.isMuted;
        const isDeafened = member.isDeafened;
        const isReconnecting = member.presenceState === MemberPresenceState.Reconnecting;
        const isOffline = member.presenceState === MemberPresenceState.Offline;

        return (
          <div
            key={member.id}
            style={{
              position: "relative",
              width: `${avatarSize}px`,
              height: `${avatarSize}px`,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                overflow: "hidden",
                background: "rgba(255,255,255,0.82)",
                border: isSpeaking ? "2px solid rgba(77, 163, 255, 0.62)" : "1px solid rgba(255, 255, 255, 0.78)",
                boxShadow: isSpeaking
                  ? "0 0 0 3px rgba(77, 163, 255, 0.12), 0 0 14px rgba(77, 163, 255, 0.42), 0 2px 6px rgba(30, 45, 70, 0.1)"
                  : "0 2px 8px rgba(30, 45, 70, 0.1)",
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
                  transform: "scale(1.18)",
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
                  width: 14,
                  height: 14,
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
                  width: 14,
                  height: 14,
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
                  width: 14,
                  height: 14,
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
    </div>
  );
};
