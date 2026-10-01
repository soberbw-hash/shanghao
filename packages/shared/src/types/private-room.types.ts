/** Display codes are never storage keys. Room IDs survive renames and code cooldowns. */
export const ROOM_ICON_IDS = [
  "gamepad",
  "headphones",
  "microphone",
  "keyboard",
  "mouse",
  "monitor",
  "bolt",
  "flame",
  "star",
  "moon",
  "sun",
  "cloud",
  "rocket",
  "ghost",
  "cat",
  "dog",
  "coffee",
  "dice",
  "cards",
  "crown",
] as const;
export type RoomIconId = (typeof ROOM_ICON_IDS)[number];
export const isRoomIconId = (value: unknown): value is RoomIconId =>
  typeof value === "string" && ROOM_ICON_IDS.includes(value as RoomIconId);
export const isChannelCode = (value: unknown): value is string =>
  typeof value === "string" && /^\d{6}$/.test(value);
export const isPrivateRoomId = (value: unknown): value is string =>
  typeof value === "string" && /^room_[a-f0-9]{32}$/.test(value);
/** Legacy IDs remain readable for existing recordings and cached reports only. */
export const isStoredRoomId = (value: unknown): value is string =>
  value === "main" || value === "side" || isPrivateRoomId(value);
export const MAX_CREATED_ROOMS = 3;
export const ROOM_CODE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1_000;

export interface PrivateRoomInfo {
  roomId: string;
  channelCode: string;
  name: string;
  icon: RoomIconId;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  onlineCount: number;
  capacity: number;
}
export interface RoomBan {
  userId: string;
  displayName: string;
  bannedAt: string;
}
export interface CreatePrivateRoomRequest {
  channelCode?: string;
  name?: string;
  icon?: RoomIconId;
}
export interface UpdatePrivateRoomRequest {
  roomId: string;
  name: string;
  icon: RoomIconId;
}

export interface PrivateRoomHistory {
  lastRoomId?: string;
  recent: PrivateRoomInfo[];
  favorites: PrivateRoomInfo[];
}
export interface PrivateRoomsApi {
  mine: () => Promise<PrivateRoomInfo[]>;
  find: (channelCode: string) => Promise<PrivateRoomInfo>;
  get: (roomId: string) => Promise<PrivateRoomInfo>;
  randomCode: () => Promise<string>;
  available: (channelCode: string) => Promise<boolean>;
  create: (request: CreatePrivateRoomRequest) => Promise<PrivateRoomInfo>;
  update: (request: UpdatePrivateRoomRequest) => Promise<PrivateRoomInfo>;
  delete: (roomId: string) => Promise<void>;
  kick: (roomId: string, peerId: string) => Promise<void>;
  ban: (roomId: string, userId: string, displayName: string) => Promise<void>;
  unban: (roomId: string, userId: string) => Promise<void>;
  bans: (roomId: string) => Promise<RoomBan[]>;
  history: () => Promise<PrivateRoomHistory>;
  rememberJoined: (roomId: string) => Promise<PrivateRoomHistory>;
  favorite: (roomId: string, enabled: boolean) => Promise<PrivateRoomHistory>;
}

export const isPrivateRoomInfo = (value: unknown): value is PrivateRoomInfo => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const room = value as PrivateRoomInfo;
  return (
    isPrivateRoomId(room.roomId) &&
    isChannelCode(room.channelCode) &&
    isRoomIconId(room.icon) &&
    typeof room.name === "string" &&
    room.name.trim().length > 0 &&
    [...room.name].length <= 32 &&
    typeof room.ownerId === "string" &&
    room.ownerId.length > 0 &&
    room.ownerId.length <= 128 &&
    typeof room.createdAt === "string" &&
    Number.isFinite(Date.parse(room.createdAt)) &&
    typeof room.updatedAt === "string" &&
    Number.isFinite(Date.parse(room.updatedAt)) &&
    Number.isInteger(room.onlineCount) &&
    room.onlineCount >= 0 &&
    room.onlineCount <= 5 &&
    room.capacity === 5
  );
};
