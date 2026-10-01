import type { PrivateRoomInfo } from "@private-voice/shared";

export const cleanTrayRoomName = (name: string): string =>
  // Remove control characters before passing untrusted names to native menus.
  // eslint-disable-next-line no-control-regex
  name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 30);
export interface PresenceContext {
  scope?: string;
  enabled: boolean;
  foreground: boolean;
  inRoom: boolean;
  suspended: boolean;
}
export const shouldPollRoomPresence = (context: PresenceContext): boolean =>
  Boolean(
    context.scope &&
    context.enabled &&
    !context.foreground &&
    !context.inRoom &&
    !context.suspended,
  );

export class RoomPresenceBaseline {
  private counts = new Map<string, number>();
  private cooldowns = new Map<string, number>();
  private recentNotifications: number[] = [];
  update(rooms: PrivateRoomInfo[], now: number): PrivateRoomInfo[] {
    this.recentNotifications = this.recentNotifications.filter((at) => now - at < 600_000);
    const notify: PrivateRoomInfo[] = [];
    const current = new Set(rooms.map((room) => room.roomId));
    for (const room of rooms) {
      if (
        this.counts.get(room.roomId) === 0 &&
        room.onlineCount > 0 &&
        now - (this.cooldowns.get(room.roomId) ?? -Infinity) >= 600_000 &&
        this.recentNotifications.length < 3
      ) {
        notify.push(room);
        this.cooldowns.set(room.roomId, now);
        this.recentNotifications.push(now);
      }
      this.counts.set(room.roomId, room.onlineCount);
    }
    for (const id of this.counts.keys()) if (!current.has(id)) this.counts.delete(id);
    // Cooldowns survive temporary omissions but remain bounded for a long running session.
    for (const [id, at] of this.cooldowns)
      if (now - at >= 600_000 && !current.has(id)) this.cooldowns.delete(id);
    return notify;
  }
}

interface WatcherDependencies {
  context(): PresenceContext;
  mine(signal: AbortSignal): Promise<PrivateRoomInfo[]>;
  favorites(): Promise<PrivateRoomInfo[]>;
  get(id: string, signal: AbortSignal): Promise<PrivateRoomInfo>;
  foregroundBusy(): boolean;
  notify(room: PrivateRoomInfo): void;
  updateTray(rooms: PrivateRoomInfo[]): void;
  trace(reason: string): void;
  now?(): number;
}
const stopRoom = /room_not_found|room_deleted|room_banned|room_access_denied|room_forbidden/;
const stopScope =
  /room_server_upgrade_required|account_session_expired|account_not_authenticated|account_auth_required|account_login_required/;

/** Owns one bounded serial poll; no member identities, tokens or persistent presence state. */
export class RoomPresenceWatcher {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private closed = false;
  private generation = 0;
  private scope?: string;
  private enabled = false;
  private blocked = false;
  private deniedRooms = new Set<string>();
  private baseline = new RoomPresenceBaseline();
  private delay = 60_000;
  private active?: AbortController;
  constructor(private readonly dependencies: WatcherDependencies) {}
  refresh(): void {
    const context = this.dependencies.context();
    if (
      !shouldPollRoomPresence(context) ||
      context.scope !== this.scope ||
      context.enabled !== this.enabled
    )
      if (this.active && !this.active.signal.aborted) {
        this.generation++;
        this.active.abort();
      }
    if (context.scope !== this.scope || context.enabled !== this.enabled) {
      this.scope = context.scope;
      this.enabled = context.enabled;
      this.generation++;
      this.blocked = false;
      this.deniedRooms.clear();
      this.baseline = new RoomPresenceBaseline();
      this.delay = 60_000;
      this.dependencies.updateTray([]);
    }
    if (this.timer) clearTimeout(this.timer);
    if (this.closed || context.suspended) return;
    this.timer = setTimeout(() => void this.poll(), 0);
  }
  stop(): void {
    this.closed = true;
    this.generation++;
    this.active?.abort();
    if (this.timer) clearTimeout(this.timer);
  }
  async poll(): Promise<void> {
    if (this.closed || this.running) return;
    this.running = true;
    const controller = new AbortController();
    this.active = controller;
    const owner = this.generation;
    const context = this.dependencies.context();
    const current = () =>
      !controller.signal.aborted &&
      !this.closed &&
      owner === this.generation &&
      context.scope === this.dependencies.context().scope &&
      shouldPollRoomPresence(this.dependencies.context());
    try {
      if (this.blocked || !shouldPollRoomPresence(context) || this.dependencies.foregroundBusy())
        return;
      const mine = await this.dependencies.mine(controller.signal);
      if (!current()) return;
      const favorites = await this.dependencies.favorites();
      if (!current()) return;
      const rooms = mine.filter((room) => !this.deniedRooms.has(room.roomId)).slice(0, 8);
      const uniqueFavorites = [...new Map(favorites.map((room) => [room.roomId, room])).values()];
      const ids = uniqueFavorites
        .filter(
          (room) =>
            !this.deniedRooms.has(room.roomId) &&
            !rooms.some((owned) => owned.roomId === room.roomId),
        )
        .slice(0, Math.min(7, 8 - rooms.length));
      let hadTransientError = false;
      for (const saved of ids) {
        if (!current() || this.dependencies.foregroundBusy()) return;
        try {
          rooms.push(await this.dependencies.get(saved.roomId, controller.signal));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (stopScope.test(reason)) throw error;
          if (stopRoom.test(reason)) {
            if (this.deniedRooms.size >= 256)
              this.deniedRooms.delete(this.deniedRooms.values().next().value!);
            this.deniedRooms.add(saved.roomId);
          } else {
            hadTransientError = true;
            this.dependencies.trace("presence_room_retry");
          }
        }
      }
      if (!current()) return;
      this.dependencies.updateTray(rooms.filter((room) => room.onlineCount > 0));
      for (const room of this.baseline.update(rooms, this.dependencies.now?.() ?? Date.now()))
        this.dependencies.notify(room);
      this.delay = hadTransientError ? Math.min(300_000, this.delay * 2) : 60_000;
    } catch (error) {
      if (controller.signal.aborted || owner !== this.generation || this.closed) return;
      const reason = error instanceof Error ? error.message : String(error);
      if (stopScope.test(reason)) {
        this.blocked = true;
        this.dependencies.updateTray([]);
        this.dependencies.trace("presence_session_stopped");
      } else {
        this.delay = Math.min(300_000, this.delay * 2);
        this.dependencies.trace("presence_poll_retry");
      }
    } finally {
      this.running = false;
      if (this.active === controller) this.active = undefined;
      if (!this.closed && !this.dependencies.context().suspended) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.poll(), owner === this.generation ? this.delay : 0);
      }
    }
  }
}
