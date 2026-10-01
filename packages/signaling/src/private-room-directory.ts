import { randomInt, randomUUID } from "node:crypto";
import {
  MAX_CREATED_ROOMS,
  MAX_ROOM_MEMBERS,
  ROOM_CODE_COOLDOWN_MS,
  ROOM_ICON_IDS,
  isChannelCode,
  isPrivateRoomId,
  isRoomIconId,
  type CreatePrivateRoomRequest,
  type PrivateRoomInfo,
  type RoomBan,
  type UpdatePrivateRoomRequest,
} from "@private-voice/shared";
import { VersionedJsonStore } from "./versioned-json-store";

interface StoredRoom extends Omit<PrivateRoomInfo, "onlineCount" | "capacity"> {
  bans: RoomBan[];
}
interface DirectoryData {
  version: 1;
  rooms: StoredRoom[];
  cooldowns: Array<{ channelCode: string; reusableAt: number }>;
}
export type PrivateRoomErrorCode =
  | "room_invalid_request"
  | "room_not_found"
  | "room_limit_reached"
  | "room_code_unavailable"
  | "room_owner_required"
  | "room_banned"
  | "room_directory_full";
export class PrivateRoomError extends Error {
  constructor(readonly code: PrivateRoomErrorCode) {
    super(code);
  }
}
const invalid = (): never => {
  throw new PrivateRoomError("room_invalid_request");
};
const nameText = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value.trim()].length > 32 ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    invalid();
  return (value as string).trim();
};
const identityText = (value: unknown): string => {
  if (typeof value !== "string" || !value || value.length > 128) invalid();
  return value as string;
};
const timestamp = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const validateDirectory = (value: unknown): DirectoryData => {
  if (!value || typeof value !== "object") invalid();
  const data = value as DirectoryData;
  if (data.version !== 1 || !Array.isArray(data.rooms) || !Array.isArray(data.cooldowns)) invalid();
  if (data.rooms.length > 100_000 || data.cooldowns.length > 1_000_000) invalid();
  const ids = new Set<string>();
  const codes = new Set<string>();
  const owners = new Map<string, number>();
  for (const room of data.rooms) {
    if (
      !room ||
      !isPrivateRoomId(room.roomId) ||
      !isChannelCode(room.channelCode) ||
      !isRoomIconId(room.icon) ||
      !timestamp(room.createdAt) ||
      !timestamp(room.updatedAt) ||
      !Array.isArray(room.bans) ||
      room.bans.length > 1_000
    )
      invalid();
    nameText(room.name);
    identityText(room.ownerId);
    if (ids.has(room.roomId) || codes.has(room.channelCode)) invalid();
    ids.add(room.roomId);
    codes.add(room.channelCode);
    const owned = (owners.get(room.ownerId) ?? 0) + 1;
    if (owned > MAX_CREATED_ROOMS) invalid();
    owners.set(room.ownerId, owned);
    const banned = new Set<string>();
    for (const ban of room.bans) {
      if (!ban || !timestamp(ban.bannedAt)) invalid();
      identityText(ban.userId);
      nameText(ban.displayName);
      if (ban.userId === room.ownerId || banned.has(ban.userId)) invalid();
      banned.add(ban.userId);
    }
  }
  for (const entry of data.cooldowns) {
    if (
      !entry ||
      !isChannelCode(entry.channelCode) ||
      !Number.isSafeInteger(entry.reusableAt) ||
      entry.reusableAt < 0 ||
      codes.has(entry.channelCode)
    )
      invalid();
    codes.add(entry.channelCode);
  }
  return data;
};

/** Permanent room identity and access policy; owns no sockets, tracks or membership. */
export class PrivateRoomDirectory {
  private cachedRevision = -1;
  private readonly byId = new Map<string, StoredRoom>();
  private readonly byCode = new Map<string, StoredRoom>();
  private readonly byOwner = new Map<string, StoredRoom[]>();
  private constructor(
    private readonly store: VersionedJsonStore<DirectoryData>,
    private readonly now: () => number,
  ) {}
  static async open(
    filePath?: string,
    now: () => number = Date.now,
  ): Promise<PrivateRoomDirectory> {
    return new PrivateRoomDirectory(
      await VersionedJsonStore.open(
        filePath,
        { version: 1, rooms: [], cooldowns: [] },
        validateDirectory,
      ),
      now,
    );
  }
  get(roomId: string): PrivateRoomInfo {
    this.refreshIndex();
    const room = this.byId.get(roomId);
    if (!room) throw new PrivateRoomError("room_not_found");
    return this.info(room);
  }
  find(channelCode: string): PrivateRoomInfo {
    if (!isChannelCode(channelCode)) invalid();
    this.refreshIndex();
    const room = this.byCode.get(channelCode);
    if (!room) throw new PrivateRoomError("room_not_found");
    return this.info(room);
  }
  ownedBy(ownerId: string): PrivateRoomInfo[] {
    this.refreshIndex();
    return (this.byOwner.get(ownerId) ?? []).map((room) => this.info(room));
  }
  available(channelCode: string): boolean {
    if (!isChannelCode(channelCode)) invalid();
    return this.codeAvailable(this.store.snapshot(), channelCode);
  }
  randomAvailableCode(): string {
    return this.randomCode(this.store.snapshot());
  }
  assertCanJoin(roomId: string, userId: string): PrivateRoomInfo {
    this.refreshIndex();
    const room = this.byId.get(roomId);
    if (!room) throw new PrivateRoomError("room_not_found");
    if (room.bans.some((ban) => ban.userId === userId)) throw new PrivateRoomError("room_banned");
    return this.info(room);
  }
  assertOwner(roomId: string, ownerId: string): void {
    if (this.get(roomId).ownerId !== ownerId) throw new PrivateRoomError("room_owner_required");
  }
  bans(roomId: string, ownerId: string): RoomBan[] {
    this.assertOwner(roomId, ownerId);
    return structuredClone(this.byId.get(roomId)!.bans);
  }
  create(
    ownerId: string,
    displayName: string,
    request: CreatePrivateRoomRequest,
  ): Promise<PrivateRoomInfo> {
    identityText(ownerId);
    const name = nameText(request.name ?? `${displayName}的房间`.slice(0, 32));
    if (request.channelCode !== undefined && !isChannelCode(request.channelCode)) invalid();
    if (request.icon !== undefined && !isRoomIconId(request.icon)) invalid();
    return this.store.transact((draft) => {
      if (draft.rooms.filter((room) => room.ownerId === ownerId).length >= MAX_CREATED_ROOMS)
        throw new PrivateRoomError("room_limit_reached");
      draft.cooldowns = draft.cooldowns.filter((entry) => entry.reusableAt > this.now());
      if (draft.rooms.length >= 100_000) throw new PrivateRoomError("room_directory_full");
      const channelCode = request.channelCode ?? this.randomCode(draft);
      if (!this.codeAvailable(draft, channelCode))
        throw new PrivateRoomError("room_code_unavailable");
      const stamp = new Date(this.now()).toISOString();
      const room: StoredRoom = {
        roomId: `room_${randomUUID().replaceAll("-", "")}`,
        channelCode,
        name,
        icon: request.icon ?? ROOM_ICON_IDS[randomInt(ROOM_ICON_IDS.length)]!,
        ownerId,
        createdAt: stamp,
        updatedAt: stamp,
        bans: [],
      };
      draft.rooms.push(room);
      return this.info(room);
    });
  }
  update(ownerId: string, request: UpdatePrivateRoomRequest): Promise<PrivateRoomInfo> {
    const name = nameText(request.name);
    if (!isRoomIconId(request.icon)) invalid();
    return this.store.transact((draft) => {
      const room = this.ownedRoom(draft, request.roomId, ownerId);
      room.name = name;
      room.icon = request.icon;
      room.updatedAt = new Date(this.now()).toISOString();
      return this.info(room);
    });
  }
  delete(roomId: string, ownerId: string): Promise<void> {
    return this.store.transact((draft) => {
      const room = this.ownedRoom(draft, roomId, ownerId);
      draft.rooms = draft.rooms.filter((entry) => entry.roomId !== roomId);
      draft.cooldowns = draft.cooldowns.filter((entry) => entry.reusableAt > this.now());
      draft.cooldowns.push({
        channelCode: room.channelCode,
        reusableAt: this.now() + ROOM_CODE_COOLDOWN_MS,
      });
    });
  }
  ban(roomId: string, ownerId: string, userId: string, displayName: string): Promise<void> {
    identityText(userId);
    const name = nameText(displayName);
    return this.store.transact((draft) => {
      const room = this.ownedRoom(draft, roomId, ownerId);
      if (userId === ownerId) invalid();
      if (room.bans.some((ban) => ban.userId === userId)) return;
      if (room.bans.length >= 1_000) invalid();
      room.bans.push({ userId, displayName: name, bannedAt: new Date(this.now()).toISOString() });
    });
  }
  unban(roomId: string, ownerId: string, userId: string): Promise<void> {
    identityText(userId);
    return this.store.transact((draft) => {
      const room = this.ownedRoom(draft, roomId, ownerId);
      room.bans = room.bans.filter((ban) => ban.userId !== userId);
    });
  }
  flush(): Promise<void> {
    return this.store.flush();
  }
  private refreshIndex(): void {
    if (this.cachedRevision === this.store.getRevision()) return;
    this.byId.clear();
    this.byCode.clear();
    this.byOwner.clear();
    for (const room of this.store.snapshot().rooms) {
      this.byId.set(room.roomId, room);
      this.byCode.set(room.channelCode, room);
      const owned = this.byOwner.get(room.ownerId) ?? [];
      owned.push(room);
      this.byOwner.set(room.ownerId, owned);
    }
    this.cachedRevision = this.store.getRevision();
  }
  private ownedRoom(data: DirectoryData, roomId: string, ownerId: string): StoredRoom {
    const room = data.rooms.find((entry) => entry.roomId === roomId);
    if (!room) throw new PrivateRoomError("room_not_found");
    if (room.ownerId !== ownerId) throw new PrivateRoomError("room_owner_required");
    return room;
  }
  private info({ bans: _bans, ...room }: StoredRoom): PrivateRoomInfo {
    return { ...room, onlineCount: 0, capacity: MAX_ROOM_MEMBERS };
  }
  private codeAvailable(data: DirectoryData, code: string): boolean {
    return (
      !data.rooms.some((room) => room.channelCode === code) &&
      !data.cooldowns.some((entry) => entry.channelCode === code && entry.reusableAt > this.now())
    );
  }
  private randomCode(data: DirectoryData): string {
    const occupied = new Set([
      ...data.rooms.map((room) => room.channelCode),
      ...data.cooldowns
        .filter((entry) => entry.reusableAt > this.now())
        .map((entry) => entry.channelCode),
    ]);
    // A bounded scan from a random position also works when random collisions repeat.
    const start = randomInt(1_000_000);
    for (let offset = 0; offset < 1_000_000; offset++) {
      const code = ((start + offset) % 1_000_000).toString().padStart(6, "0");
      if (!occupied.has(code)) return code;
    }
    throw new PrivateRoomError("room_directory_full");
  }
}
