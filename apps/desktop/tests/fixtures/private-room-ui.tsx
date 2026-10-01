import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DesktopApi, PrivateRoomInfo, PrivateRoomHistory } from "@private-voice/shared";
import "../../src/renderer/src/styles/index.css";

// Browser-only in-memory fixture: no native storage, credentials, media capture or real server.
const room: PrivateRoomInfo = {
  roomId: `room_${"a".repeat(32)}`,
  channelCode: "000021",
  name: "今晚一起上号",
  icon: "headphones",
  ownerId: "fixture",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  onlineCount: 2,
  capacity: 5,
};
let rooms = [room];
let history: PrivateRoomHistory = { lastRoomId: room.roomId, recent: [room], favorites: [] };
window.desktopApi = {
  app: { writeLog: async () => {} },
  rooms: {
    history: async () => structuredClone(history),
    mine: async () => structuredClone(rooms),
    get: async (id) => {
      const result = rooms.find((item) => item.roomId === id);
      if (!result) throw new Error("room_not_found");
      return structuredClone(result);
    },
    find: async (code) => {
      const result = rooms.find((item) => item.channelCode === code);
      if (!result) throw new Error("room_not_found");
      return structuredClone(result);
    },
    randomCode: async () => "018620",
    available: async (code) => !rooms.some((item) => item.channelCode === code),
    create: async (request) => {
      const created = {
        ...room,
        ...request,
        roomId: `room_${"b".repeat(32)}`,
        channelCode: request.channelCode ?? "018620",
        name: request.name ?? "Fixture的房间",
        icon: request.icon ?? "moon",
        onlineCount: 0,
      };
      rooms.push(created);
      return created;
    },
    update: async (request) => {
      const result = rooms.find((item) => item.roomId === request.roomId)!;
      Object.assign(result, request);
      return result;
    },
    delete: async (id) => {
      rooms = rooms.filter((item) => item.roomId !== id);
    },
    favorite: async (id, enabled) => {
      history = {
        ...history,
        favorites: enabled ? [rooms.find((item) => item.roomId === id)!] : [],
      };
      return structuredClone(history);
    },
  },
  storage: {
    inspect: async () => [{ category: "models", bytes: 4 * 1024 ** 3, files: 3, complete: true }],
    clearExpiredTemporary: async () => ({ removed: 2, removedBytes: 1024 ** 2 }),
  },
} as unknown as DesktopApi;
const [{ PrivateRoomBrowser }, { StorageSettingsCard }, { useAccountStore }, { useSettingsStore }] =
  await Promise.all([
    import("../../src/renderer/src/components/room/PrivateRoomBrowser"),
    import("../../src/renderer/src/components/settings/StorageSettingsCard"),
    import("../../src/renderer/src/store/accountStore"),
    import("../../src/renderer/src/store/settingsStore"),
  ]);
useAccountStore.setState({
  snapshot: {
    configured: true,
    guestAllowed: false,
    status: "authenticated",
    profile: { userId: "fixture", username: "fixture", displayName: "Fixture" },
  },
});
useSettingsStore.setState({ settings: undefined });
function Fixture() {
  const [joined, setJoined] = useState("");
  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-2">
      <section className="island-panel rounded-3xl p-6">
        <PrivateRoomBrowser busy={false} onJoin={async (room) => setJoined(room.channelCode)} />
        <p role="status" data-testid="joined">
          {joined ? `已明确加入 ${joined}` : "尚未加入"}
        </p>
      </section>
      <StorageSettingsCard isActive />
    </main>
  );
}
const container = document.getElementById("root")! as HTMLElement & { fixtureRoot?: Root };
container.fixtureRoot ??= createRoot(container);
container.fixtureRoot.render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
