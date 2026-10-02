import type { PrivateRoomHistory, PrivateRoomInfo } from "@private-voice/shared";
export interface DirectorySnapshot {
  scope: string;
  history: PrivateRoomHistory;
  mine: PrivateRoomInfo[];
  loading: boolean;
  error: string;
}
// One bounded, in-memory snapshot. No room data is shared across account/server scopes.
let cached: DirectorySnapshot | undefined;
export const rememberRoomDirectory = (
  userId: string | undefined,
  serverUrl: string,
  room: PrivateRoomInfo,
): void => {
  const scope = JSON.stringify([userId, serverUrl]);
  cached = seed(scope, room);
  cached.loading = false;
};
export const mergeHistory = (
  history: PrivateRoomHistory,
  mine: PrivateRoomInfo[],
  currentRoom?: PrivateRoomInfo,
): PrivateRoomHistory => {
  const fresh = new Map(mine.map((room) => [room.roomId, room]));
  if (currentRoom && !fresh.has(currentRoom.roomId)) fresh.set(currentRoom.roomId, currentRoom);
  const recent = history.recent.map((room) => fresh.get(room.roomId) ?? room);
  if (currentRoom && !recent.some((room) => room.roomId === currentRoom.roomId))
    recent.unshift(fresh.get(currentRoom.roomId) ?? currentRoom);
  return {
    ...history,
    lastRoomId: currentRoom?.roomId ?? history.lastRoomId,
    recent: recent.slice(0, 20),
    favorites: history.favorites.map((room) => fresh.get(room.roomId) ?? room),
  };
};
export const seed = (scope: string, currentRoom?: PrivateRoomInfo): DirectorySnapshot => {
  const saved = cached?.scope === scope ? cached : undefined;
  return {
    scope,
    history: mergeHistory(saved?.history ?? { recent: [], favorites: [] }, [], currentRoom),
    mine: saved?.mine ?? [],
    loading: !saved && !currentRoom,
    error: "",
  };
};
export const cacheRoomDirectory = (snapshot: DirectorySnapshot): void => {
  cached = snapshot;
};
