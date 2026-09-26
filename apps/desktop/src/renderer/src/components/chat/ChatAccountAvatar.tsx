import {
  accountAvatarPresetForIdentity,
  isAccountAvatarPresetId,
  type ChatMessage,
} from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import { useAccountStore } from "../../store/accountStore";
import { useSettingsStore } from "../../store/settingsStore";
import { accountAvatarPresetSource } from "../../features/account/accountAvatarPresets";
import { AccountAvatar } from "../account/AccountAvatar";

export const ChatAccountAvatar = ({ message }: { message: ChatMessage }) => {
  // A primitive selector ignores speaking/latency updates and follows account-photo changes.
  const currentAvatar = useRoomStore((state) => {
    const member = state.room.members.find(
      (member) => member.id === message.peerId || (message.isLocal === true && member.isLocal),
    );
    return (
      member?.avatarUrl ||
      accountAvatarPresetSource(member?.accountAvatarPresetId) ||
      member?.avatarDataUrl
    );
  });
  const memberIdentity = useRoomStore(
    (state) =>
      state.room.members.find(
        (member) => member.id === message.peerId || (message.isLocal === true && member.isLocal),
      )?.userId,
  );
  const localPortrait = useAccountStore((state) =>
    message.isLocal ? state.snapshot.profile?.avatarUrl : undefined,
  );
  const localIdentity = useAccountStore((state) =>
    message.isLocal ? state.snapshot.profile?.userId : undefined,
  );
  const localPresetId = useAccountStore((state) =>
    message.isLocal ? state.snapshot.profile?.accountAvatarPresetId : undefined,
  );
  const localSettingPresetId = useSettingsStore((state) =>
    message.isLocal ? state.settings?.accountAvatarPresetId : undefined,
  );
  const fallbackIdentity = localIdentity || memberIdentity || message.senderProfileId;
  const fallbackSrc = fallbackIdentity?.startsWith("guest:")
    ? undefined
    : accountAvatarPresetSource(
        fallbackIdentity ? accountAvatarPresetForIdentity(fallbackIdentity) : undefined,
      );
  return (
    <AccountAvatar
      name={message.nickname}
      src={
        localPortrait ||
        currentAvatar ||
        accountAvatarPresetSource(
          localPresetId ||
            (isAccountAvatarPresetId(localSettingPresetId) ? localSettingPresetId : undefined),
        ) ||
        message.avatarUrl ||
        accountAvatarPresetSource(message.accountAvatarPresetId) ||
        message.avatarDataUrl ||
        fallbackSrc
      }
      fallbackSrc={fallbackSrc}
      className="chat-message-avatar mt-0.5 h-7 w-7 shrink-0 rounded-[10px]"
    />
  );
};
