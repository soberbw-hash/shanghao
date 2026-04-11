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
      presenceState === MemberPresenceState.Online && "bg-[#16A34A]",
      presenceState === MemberPresenceState.Connecting && "bg-[#F59E0B]",
      presenceState === MemberPresenceState.Reconnecting && "bg-[#4DA3FF]",
      presenceState === MemberPresenceState.Offline && "bg-[#CBD5E1]",
    )}
  />
);
