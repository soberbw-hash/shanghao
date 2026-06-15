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

  const members = state.members.filter((member) => !member.isEmptySlot);
  const activeMember =
    members.find((member) => member.speakingState === MemberSpeakingState.Speaking) ??
    members.find((member) => member.isLocal) ??
    members[0];

  const isSpeaking = activeMember?.speakingState === MemberSpeakingState.Speaking;
  const isMuted = activeMember?.isMuted ?? false;
  const isDeafened = activeMember?.isDeafened ?? false;
  const isReconnecting = activeMember?.presenceState === MemberPresenceState.Reconnecting;

  const getBorderColor = () => {
    if (isSpeaking) return "rgba(77, 163, 255, 0.6)";
    if (isMuted || isDeafened) return "rgba(156, 163, 175, 0.4)";
    if (isReconnecting) return "rgba(245, 158, 11, 0.4)";
    return "rgba(220, 230, 242, 0.5)";
  };

  const getStatusColor = () => {
    if (isSpeaking) return "#4DA3FF";
    if (isMuted || isDeafened) return "#9CA3AF";
    if (isReconnecting) return "#F59E0B";
    return "#18B66A";
  };

  return (
    <div
      className="overlay-capsule drag-region"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: "48px",
        height: "48px",
        borderRadius: "24px",
        background: "rgba(255, 255, 255, 0.8)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: `2px solid ${getBorderColor()}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        boxShadow: `0 2px 8px rgba(30, 45, 70, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.6) inset`,
        transition: "border-color 300ms ease, box-shadow 300ms ease",
      }}
    >
      {activeMember ? (
        <>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isSpeaking ? "rgba(77, 163, 255, 0.08)" : "transparent",
              transition: "background 300ms ease",
            }}
          >
            <img
              src={getAvatarSrc(activeMember.avatarId)}
              alt=""
              draggable={false}
              style={{
                width: "32px",
                height: "32px",
                objectFit: "contain",
                filter: isMuted || isDeafened ? "saturate(0.5)" : "none",
                transition: "filter 300ms ease",
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              bottom: "1px",
              right: "1px",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: getStatusColor(),
              border: "2px solid white",
              boxShadow: `0 0 4px ${getStatusColor()}40`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isMuted && <MicOff className="h-1.5 w-1.5 text-white" />}
            {isDeafened && <VolumeX className="h-1.5 w-1.5 text-white" />}
            {isReconnecting && <RotateCw className="h-1.5 w-1.5 text-white animate-spin" />}
          </div>
        </>
      ) : null}
    </div>
  );
};
