import { cn } from "@private-voice/ui";
import { MemberPresenceState } from "@private-voice/shared";

export const MemberPresenceDot = ({
  presenceState,
}: {
  presenceState: MemberPresenceState;
}) => (
  <span
    className={cn(
      "inline-flex h-2.5 w-2.5 rounded-full",
      presenceState === MemberPresenceState.Online && "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.7)]",
      presenceState === MemberPresenceState.Connecting && "bg-amber-300",
      presenceState === MemberPresenceState.Reconnecting && "bg-sky-300",
      presenceState === MemberPresenceState.Offline && "bg-white/16",
    )}
  />
);
