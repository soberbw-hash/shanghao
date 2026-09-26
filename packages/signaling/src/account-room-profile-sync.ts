import type { AccountProfile } from "@private-voice/shared";

import type { RoomManager } from "./room-manager";

export const syncAccountProfileAcrossRooms = (
  roomManager: RoomManager,
  profile: AccountProfile,
  broadcastSnapshot: (roomId: string) => void,
): void => {
  for (const room of roomManager.listRooms()) {
    const changed = room.peers.updateAccountProfile(profile.userId, {
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      accountAvatarPresetId: profile.accountAvatarPresetId,
    });
    if (changed) broadcastSnapshot(room.roomId);
  }
};
