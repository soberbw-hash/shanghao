import {
  isChannelCode,
  isPrivateRoomId,
  isPrivateRoomInfo,
  isRoomIconId,
  isRoomIconColor,
  type CreatePrivateRoomRequest,
  type PrivateRoomInfo,
  type PrivateRoomsApi,
  type RoomBan,
  type UpdatePrivateRoomRequest,
} from "@private-voice/shared";
import type { AccountDesktopService } from "./account-service";
import { PrivateRoomHistoryStore } from "./private-room-history";
import { requestPrivateRoom } from "./private-room-request";
const required = (value: unknown, max: number): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("room_invalid_request");
  return value;
};
const roomId = (value: unknown): string => {
  if (!isPrivateRoomId(value)) throw new Error("room_invalid_request");
  return value;
};
const code = (value: unknown): string => {
  if (!isChannelCode(value)) throw new Error("room_invalid_request");
  return value;
};
const info = (value: unknown): PrivateRoomInfo => {
  if (!isPrivateRoomInfo(value)) throw new Error("room_server_invalid_response");
  return value;
};

/** Owns bounded authenticated room commands. Renderer never receives account tokens. */
export class PrivateRoomsDesktopService implements PrivateRoomsApi {
  private pending = 0;
  getPendingCount(): number {
    return this.pending;
  }
  constructor(
    private readonly accounts: Pick<AccountDesktopService, "getFreshAccessToken" | "getSnapshot">,
    private readonly getServerUrl: () => string | undefined,
    private readonly historyStore: PrivateRoomHistoryStore,
    private readonly fetcher: typeof fetch,
  ) {}
  async mine(signal?: AbortSignal) {
    const rooms = await this.request("/mine", "GET", undefined, signal);
    if (!Array.isArray(rooms) || rooms.length > 3) throw new Error("room_server_invalid_response");
    return rooms.map(info);
  }
  async find(channelCode: string) {
    const room = info(await this.request(`/find?code=${code(channelCode)}`));
    if (room.channelCode !== channelCode) throw new Error("room_server_invalid_response");
    return room;
  }
  async get(id: string, signal?: AbortSignal) {
    const room = info(await this.request(`/${roomId(id)}`, "GET", undefined, signal));
    if (room.roomId !== id) throw new Error("room_server_invalid_response");
    return room;
  }
  async randomCode(): Promise<string> {
    const result = (await this.request("/random-code")) as { channelCode?: unknown };
    return code(result.channelCode);
  }
  async available(channelCode: string): Promise<boolean> {
    const result = (await this.request(`/availability?code=${code(channelCode)}`)) as {
      available?: unknown;
    };
    if (typeof result.available !== "boolean") throw new Error("room_server_invalid_response");
    return result.available;
  }
  async create(request: CreatePrivateRoomRequest) {
    if (!request || typeof request !== "object" || Array.isArray(request))
      throw new Error("room_invalid_request");
    return info(
      await this.request("", "POST", {
        name: request.name === undefined ? undefined : required(request.name, 64),
        icon: request.icon === undefined ? undefined : this.icon(request.icon),
        iconColor: this.iconColor(request.iconColor),
        channelCode: request.channelCode === undefined ? undefined : code(request.channelCode),
      }),
    );
  }
  async update(request: UpdatePrivateRoomRequest) {
    if (!request || typeof request !== "object") throw new Error("room_invalid_request");
    return info(
      await this.request(`/${roomId(request.roomId)}`, "PUT", {
        name: required(request.name, 64),
        icon: this.icon(request.icon),
        iconColor: this.iconColor(request.iconColor),
      }),
    );
  }
  async delete(id: string) {
    await this.request(`/${roomId(id)}`, "DELETE");
  }
  async kick(id: string, peer: string) {
    await this.request(`/${roomId(id)}/kick`, "POST", { peerId: required(peer, 128) });
  }
  async ban(id: string, user: string, name: string) {
    await this.request(`/${roomId(id)}/ban`, "POST", {
      userId: required(user, 128),
      displayName: required(name, 64),
    });
  }
  async unban(id: string, user: string) {
    await this.request(`/${roomId(id)}/unban`, "POST", { userId: required(user, 128) });
  }
  async bans(id: string): Promise<RoomBan[]> {
    const bans = await this.request(`/${roomId(id)}/bans`);
    if (
      !Array.isArray(bans) ||
      bans.length > 1_000 ||
      !bans.every(
        (ban) =>
          ban &&
          typeof ban.userId === "string" &&
          ban.userId.length <= 128 &&
          typeof ban.displayName === "string" &&
          ban.displayName.length <= 64 &&
          typeof ban.bannedAt === "string" &&
          Number.isFinite(Date.parse(ban.bannedAt)),
      )
    )
      throw new Error("room_server_invalid_response");
    return bans;
  }
  async history() {
    return this.historyStore.read(this.scope());
  }
  async rememberJoined(id: string) {
    const scope = this.scope();
    const metadata = await this.get(id);
    if (scope !== this.scope()) throw new Error("account_session_expired");
    return this.historyStore.remember(scope, metadata);
  }
  async favorite(id: string, enabled: boolean) {
    roomId(id);
    if (typeof enabled !== "boolean") throw new Error("room_invalid_request");
    const scope = this.scope();
    if (!enabled) return this.historyStore.removeFavorite(scope, id);
    const metadata = await this.get(id);
    if (scope !== this.scope()) throw new Error("account_session_expired");
    return this.historyStore.favorite(scope, metadata, true);
  }
  private icon(value: unknown) {
    if (!isRoomIconId(value)) throw new Error("room_invalid_request");
    return value;
  }
  private iconColor(value: unknown) {
    if (value !== undefined && !isRoomIconColor(value)) throw new Error("room_invalid_request");
    return value;
  }
  private scope(): string {
    const snapshot = this.accounts.getSnapshot();
    if (snapshot.status !== "signed_in" || !snapshot.profile)
      throw new Error("account_session_expired");
    const url = this.server();
    url.search = "";
    return `${url.toString()}|${snapshot.profile.userId}`;
  }
  private server(): URL {
    const url = new URL(this.getServerUrl() ?? "");
    if (!/^wss?:$/.test(url.protocol) || url.username || url.password)
      throw new Error("room_server_invalid_url");
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !this.accounts.getSnapshot().developmentConnection
    )
      throw new Error("account_secure_transport_required");
    url.hash = "";
    url.pathname = "/";
    return url;
  }
  private async request(
    route: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.pending >= 8) throw new Error("room_busy");
    const scope = this.scope();
    this.pending++;
    try {
      const token = await this.accounts.getFreshAccessToken();
      if (!token || this.scope() !== scope) throw new Error("account_session_expired");
      const url = this.server();
      url.pathname = `/api/rooms${route.split("?")[0]}`;
      url.search = route.includes("?") ? route.split("?")[1]! : "";
      const result = await requestPrivateRoom(this.fetcher, url, token, method, body, signal);
      if (this.scope() !== scope) throw new Error("account_session_expired");
      return result;
    } finally {
      this.pending--;
    }
  }
}
