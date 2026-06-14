import { useEffect, useState } from "react";
import { MicOff, X } from "lucide-react";

import { MemberSpeakingState, type OverlayState } from "@private-voice/shared";

import { getAvatarSrc } from "../utils/profile";
import { AvatarPlaceholder } from "../components/base/AvatarPlaceholder";

export const OverlayPage = () => {
  const [state, setState] = useState<OverlayState>({
    members: [],
    isMuted: false,
    connectionState: "idle",
  });

  useEffect(() => window.desktopApi.overlay.onState(setState), []);

  const members = state.members.filter((member) => !member.isEmptySlot).slice(0, 5);

  return (
    <div className="overlay-shell drag-region">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {members.map((member) => {
          const isSpeaking = member.speakingState === MemberSpeakingState.Speaking;
          return (
            <div key={member.id} className="relative flex min-w-0 flex-col items-center">
              <AvatarPlaceholder
                name={member.nickname}
                src={member.avatarDataUrl || getAvatarSrc(member.avatarId)}
                size="sm"
                className={`h-10 w-10 rounded-[13px] ${isSpeaking ? "overlay-speaking" : ""}`}
              />
              <span className="mt-1 max-w-[52px] truncate text-[9px] font-semibold text-[#526174]">
                {member.isLocal ? "你" : member.nickname}
              </span>
              {member.isMuted ? (
                <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-white text-[#8794a5] shadow-sm">
                  <MicOff className="h-2.5 w-2.5" />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="no-drag grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#8d99a8] hover:bg-white"
        onClick={() => void window.desktopApi.overlay.close()}
        aria-label="关闭悬浮小窗"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
