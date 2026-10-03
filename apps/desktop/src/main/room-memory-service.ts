import {
  isPrivateRoomId,
  isPrivateRoomInfo,
  isRoomMemorySnapshot,
  verifySavedMemoryDocument,
  roomMemoryContext,
  type RoomMemoryApi,
  type RoomMemorySnapshot,
  type SaveRoomMemoryRequest,
} from "@private-voice/shared";
import type { AccountDesktopService } from "./account-service";
import { requestPrivateRoom } from "./private-room-request";
import { validateRoomMemoryRequest } from "./room-memory-request";

/** Authenticated, bounded memory transport; account tokens remain in the main process. */
export class RoomMemoryDesktopService implements RoomMemoryApi {
  private pending = 0;
  constructor(
    private readonly accounts: Pick<AccountDesktopService, "getFreshAccessToken" | "getSnapshot">,
    private readonly getServerUrl: () => string | undefined,
    private readonly fetcher: typeof fetch,
  ) {}
  get(roomId: string, signal?: AbortSignal): Promise<RoomMemorySnapshot> {
    return this.request(roomId, "GET", undefined, signal);
  }
  save(request: SaveRoomMemoryRequest): Promise<RoomMemorySnapshot> {
    validateRoomMemoryRequest(request);
    return this.request(request.roomId, "PUT", request).then((saved) =>
      verifySavedMemoryDocument(saved, request),
    );
  }
  async context(roomId: string, signal?: AbortSignal): Promise<string> {
    if (!isPrivateRoomId(roomId)) return "";
    try {
      return roomMemoryContext(await this.get(roomId, signal));
    } catch (error) {
      if (
        error instanceof Error &&
        ["room_memory_server_upgrade_required", "room_server_upgrade_required"].includes(
          error.message,
        )
      )
        return "";
      throw error;
    }
  }
  private connection(): { url: URL; scope: string } {
    const account = this.accounts.getSnapshot();
    if (account.status !== "signed_in" || !account.profile)
      throw new Error("account_session_expired");
    const url = new URL(this.getServerUrl() ?? "");
    if (!/^wss?:$/.test(url.protocol) || url.username || url.password)
      throw new Error("room_server_invalid_url");
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !account.developmentConnection
    )
      throw new Error("account_secure_transport_required");
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return { url, scope: `${url.toString()}|${account.profile.userId}` };
  }
  private async request(
    roomId: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<RoomMemorySnapshot> {
    if (!isPrivateRoomId(roomId)) throw new Error("room_memory_invalid");
    if (this.pending >= 4) throw new Error("room_busy");
    const { url, scope } = this.connection();
    this.pending++;
    try {
      const token = await this.accounts.getFreshAccessToken();
      if (!token || scope !== this.connection().scope) throw new Error("account_session_expired");
      url.pathname = `/api/rooms/${roomId}/memory`;
      let result: unknown;
      try {
        result = await requestPrivateRoom(this.fetcher, url, token, method, body, signal);
      } catch (error) {
        if (error instanceof Error && error.message === "room_not_found") {
          if (scope !== this.connection().scope)
            throw new Error("account_session_expired", { cause: error });
          url.pathname = `/api/rooms/${roomId}`;
          const info = await requestPrivateRoom(this.fetcher, url, token, "GET", undefined, signal);
          if (scope !== this.connection().scope)
            throw new Error("account_session_expired", { cause: error });
          if (isPrivateRoomInfo(info) && info.roomId === roomId)
            throw new Error("room_memory_server_upgrade_required", { cause: error });
          throw new Error("room_server_invalid_response", { cause: error });
        }
        throw error;
      }
      if (scope !== this.connection().scope) throw new Error("account_session_expired");
      signal?.throwIfAborted();
      if (!isRoomMemorySnapshot(result) || result.roomId !== roomId)
        throw new Error("room_server_invalid_response");
      return result;
    } finally {
      this.pending--;
    }
  }
}
