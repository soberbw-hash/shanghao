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
        width: "72px",
        height: "72px",
        borderRadius: "36px",
        background: "rgba(255, 255, 255, 0.75)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: `2px solid ${getBorderColor()}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        boxShadow: `0 4px 16px rgba(30, 45, 70, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.5) inset`,
        transition: "border-color 300ms ease, box-shadow 300ms ease",
      }}
    >
      {activeMember ? (
        <>
          <div
            style={{
              width: "56px",
              height: "56px",
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
                width: "48px",
                height: "48px",
                objectFit: "contain",
                filter: isMuted || isDeafened ? "saturate(0.5)" : "none",
                transition: "filter 300ms ease",
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              bottom: "2px",
              right: "2px",
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              background: getStatusColor(),
              border: "2px solid white",
              boxShadow: `0 0 6px ${getStatusColor()}40`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isMuted && <MicOff className="h-2 w-2 text-white" />}
            {isDeafened && <VolumeX className="h-2 w-2 text-white" />}
            {isReconnecting && <RotateCw className="h-2 w-2 text-white animate-spin" />}
          </div>
        </>
      ) : null}
    </div>
  );
};
