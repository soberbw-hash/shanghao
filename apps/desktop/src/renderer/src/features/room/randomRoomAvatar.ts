import { BUILT_IN_AVATAR_IDS, type BuiltInAvatarId } from "@private-voice/shared";

let previous: BuiltInAvatarId | undefined;
/** Each new room session draws again. Reconnects keep the existing RoomClient. */
export const randomRoomAvatar = (fallback?: BuiltInAvatarId): BuiltInAvatarId => {
  const candidates = BUILT_IN_AVATAR_IDS.filter((id) => id !== (previous ?? fallback));
  previous = candidates[Math.floor(Math.random() * candidates.length)]!;
  return previous;
};
