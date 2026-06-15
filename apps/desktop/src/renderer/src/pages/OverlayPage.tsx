import { useEffect, useState } from "react";
import { MicOff, VolumeX } from "lucide-react";

import { MemberSpeakingState, type OverlayState } from "@private-voice/shared";

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

  return (
    <div
      className={`overlay-shell drag-region ${isSpeaking ? "overlay-speaking" : "overlay-idle"}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {activeMember ? (
        <>
          <img
            src={getAvatarSrc(activeMember.avatarId)}
            alt=""
            draggable={false}
            className="h-[62px] w-[62px] object-contain"
          />
          {activeMember.isMuted ? (
            <span className="overlay-status-icon">
              <MicOff className="h-3 w-3" />
            </span>
          ) : null}
          {activeMember.isDeafened ? (
            <span className="overlay-status-icon overlay-status-icon-right">
              <VolumeX className="h-3 w-3" />
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
