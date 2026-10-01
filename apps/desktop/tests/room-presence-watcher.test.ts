import assert from "node:assert/strict";
import test from "node:test";
import type { PrivateRoomInfo } from "@private-voice/shared";
import {
  RoomPresenceBaseline,
  RoomPresenceWatcher,
  shouldPollRoomPresence,
  cleanTrayRoomName,
  type PresenceContext,
} from "../src/main/room-presence-watcher";

const room = (id: string, count: number): PrivateRoomInfo => ({
  roomId: `room_${id.padEnd(32, "a")}`,
  channelCode: "000001",
  name: "夜间开黑",
  icon: "moon",
  ownerId: "user",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  onlineCount: count,
  capacity: 5,
});
const context = (): PresenceContext => ({
  scope: "server|user",
  enabled: true,
  foreground: false,
  inRoom: false,
  suspended: false,
});

test("presence baseline suppresses startup, cools rooms and caps global notifications", () => {
  const state = new RoomPresenceBaseline();
  assert.equal(state.update([room("a", 2)], 0).length, 0);
  state.update([room("a", 0)], 1_000);
  assert.equal(state.update([room("a", 1)], 2_000).length, 1);
  state.update([room("a", 0)], 3_000);
  assert.equal(state.update([room("a", 1)], 4_000).length, 0);
  state.update([room("a", 0)], 601_999);
  assert.equal(state.update([room("a", 1)], 602_000).length, 1);
  const global = new RoomPresenceBaseline();
  const rooms = ["a", "b", "c", "d"].map((id) => room(id, 0));
  global.update(rooms, 0);
  assert.equal(
    global.update(
      rooms.map((room) => ({ ...room, onlineCount: 1 })),
      1_000,
    ).length,
    3,
  );
  global.update([], 2_000);
  assert.equal(global.update([room("a", 1)], 3_000).length, 0);
});

test("background polling is opt-in, never runs in foreground, room or sleep", () => {
  assert.equal(shouldPollRoomPresence(context()), true);
  for (const patch of [
    { scope: undefined },
    { enabled: false },
    { foreground: true },
    { inRoom: true },
    { suspended: true },
  ])
    assert.equal(shouldPollRoomPresence({ ...context(), ...patch }), false);
  assert.equal(cleanTrayRoomName("房\n间\u0000"), "房间");
  assert.equal(cleanTrayRoomName("长".repeat(100)).length, 30);
});

test("polling prioritizes owned rooms, bounds requests, deduplicates and stops expired sessions", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let config = context(),
    count = 0,
    calls = 0,
    expired = false;
  const notices: string[] = [];
  const watcher = new RoomPresenceWatcher({
    context: () => config,
    mine: async () => {
      calls++;
      if (expired) throw new Error("account_session_expired");
      return [room("a", count)];
    },
    favorites: async () => [
      room("a", 0),
      ...["b", "c", "d", "e", "f", "0", "1", "2"].map((id) => room(id, 0)),
    ],
    get: async (id) => {
      calls++;
      return { ...room("a", 0), roomId: id };
    },
    foregroundBusy: () => false,
    notify: (room) => notices.push(room.roomId),
    updateTray: () => {},
    trace: () => {},
  });
  t.after(() => watcher.stop());
  watcher.refresh();
  await watcher.poll();
  assert.equal(calls, 8);
  assert.equal(notices.length, 0);
  count = 1;
  await watcher.poll();
  assert.equal(notices.length, 1);
  config = { ...config, foreground: true };
  await watcher.poll();
  assert.equal(calls, 16);
  config = { ...config, foreground: false };
  expired = true;
  await watcher.poll();
  const stoppedAt = calls;
  await watcher.poll();
  assert.equal(calls, stoppedAt);
  expired = false;
  config = { ...config, scope: "server|other-user" };
  watcher.refresh();
  await watcher.poll();
  assert.ok(calls > stoppedAt);
  assert.equal(notices.length, 1);
});

test("leaving background aborts the owned request and late results never notify", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let config = context();
  let resolveRooms!: (rooms: PrivateRoomInfo[]) => void;
  let signal: AbortSignal | undefined;
  let trayUpdates = 0;
  const watcher = new RoomPresenceWatcher({
    context: () => config,
    mine: async (ownedSignal) => {
      signal = ownedSignal;
      return new Promise((resolve) => {
        resolveRooms = resolve;
      });
    },
    favorites: async () => [],
    get: async () => room("a", 1),
    foregroundBusy: () => false,
    notify: () => assert.fail("must not notify"),
    updateTray: () => {
      trayUpdates++;
    },
    trace: () => {},
  });
  t.after(() => watcher.stop());
  watcher.refresh();
  const polling = watcher.poll();
  config = { ...config, inRoom: true };
  watcher.refresh();
  assert.equal(signal?.aborted, true);
  resolveRooms([room("a", 1)]);
  await polling;
  assert.equal(trayUpdates, 1);
});

test("poll failures back off to five minutes and recovery returns to sixty seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0,
    failed = true;
  const watcher = new RoomPresenceWatcher({
    context,
    mine: async () => {
      calls++;
      if (failed) throw new Error("network_failed");
      return [];
    },
    favorites: async () => [],
    get: async () => room("a", 0),
    foregroundBusy: () => false,
    notify: () => assert.fail("must not notify"),
    updateTray: () => {},
    trace: () => {},
  });
  t.after(() => watcher.stop());
  const flush = async () => {
    for (let n = 0; n < 10; n++) await Promise.resolve();
  };
  watcher.refresh();
  await watcher.poll();
  for (const [wait, count] of [
    [120_000, 2],
    [240_000, 3],
    [300_000, 4],
  ] as const) {
    t.mock.timers.tick(wait - 1);
    await flush();
    assert.equal(calls, count - 1);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(calls, count);
  }
  failed = false;
  t.mock.timers.tick(300_000);
  await flush();
  assert.equal(calls, 5);
  t.mock.timers.tick(59_999);
  await flush();
  assert.equal(calls, 5);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 6);
});

test("banned favorites are discarded, duplicates are skipped and foreground requests have priority", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0,
    busy = false;
  const watcher = new RoomPresenceWatcher({
    context,
    mine: async () => [],
    favorites: async () => [room("b", 0), room("b", 0)],
    get: async () => {
      calls++;
      throw new Error("room_banned");
    },
    foregroundBusy: () => busy,
    notify: () => assert.fail("must not notify"),
    updateTray: () => {},
    trace: () => {},
  });
  t.after(() => watcher.stop());
  watcher.refresh();
  busy = true;
  await watcher.poll();
  assert.equal(calls, 0);
  busy = false;
  await watcher.poll();
  await watcher.poll();
  assert.equal(calls, 1);
});
