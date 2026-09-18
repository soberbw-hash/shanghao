import type { ChatMessage } from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import { useAccountStore } from "../../store/accountStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ACCOUNT_AVATAR_PRESETS } from "../../features/account/accountAvatarPresets";
import { AccountAvatar } from "../account/AccountAvatar";

export const ChatAccountAvatar = ({ message }: { message: ChatMessage }) => {
  // A primitive selector ignores speaking/latency updates and follows account-photo changes.
  const currentAvatar = useRoomStore(
    (state) =>
      state.room.members.find(
        (member) => member.id === message.peerId || (message.isLocal === true && member.isLocal),
      )?.avatarUrl,
  );
  const localPortrait = useAccountStore((state) =>
    message.isLocal ? state.snapshot.profile?.avatarUrl : undefined,
  );
  const localPresetId = useSettingsStore((state) =>
    message.isLocal ? state.settings?.accountAvatarPresetId : undefined,
  );
  const localPreset = ACCOUNT_AVATAR_PRESETS.find((preset) => preset.id === localPresetId)?.source;
  return (
    <AccountAvatar
      name={message.nickname}
      src={
        localPortrait || currentAvatar || localPreset || message.avatarUrl || message.avatarDataUrl
      }
      className="chat-message-avatar mt-0.5 h-7 w-7 shrink-0 rounded-[10px]"
    />
  );
};
