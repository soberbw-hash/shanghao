import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file: string) =>
  readFile(new URL(`../src/renderer/src/${file}`, import.meta.url), "utf8");

test("room header shares compact actions and keeps channel codes in invitation rather than chrome", async () => {
  const topbar = await read("components/layout/TopStatusBar.tsx");
  assert.doesNotMatch(topbar, /channelCode|onManageRoom/u);
  assert.match(topbar, /topbar-action topbar-room-switch/u);
  assert.match(topbar, /aria-label="切换房间"/u);
  assert.match(topbar, /member\.presenceState === "online"/u);
  assert.match(await read("hooks/useRoomState.ts"), /privateRoomInvitationUrl\(/u);
  assert.match(await read("hooks/useRoomState.ts"), /channelCode: room\.privateRoom\.channelCode/u);
  assert.doesNotMatch(await read("pages/RoomPage.tsx"), /RoomManagementDialog|roomManagementOpen/u);
});

test("account rooms use server-owned records and the current room's live member projection", async () => {
  const source = await read("components/settings/AccountRoomsPanel.tsx");
  assert.match(
    await read("components/settings/AccountSettingsCard.tsx"),
    /AccountRoomsPanel userId=\{profile\.userId\}/u,
  );
  assert.match(source, /room\.ownerId === userId/u);
  assert.match(source, /loadedScope === scope \? rooms : \[\]/u);
  assert.match(source, /counter\.current === owner/u);
  assert.match(source, /managed\.roomId === activeRoom\.roomId/u);
  assert.match(source, /members=\{isActive \? activeRoom\.members\.filter/u);
  assert.doesNotMatch(source, /rooms\.(?:rememberJoined|create|delete)|switchChannel/u);
  assert.match(await read("components/room/RoomManagementDialog.tsx"), /onSaved=\{onClose\}/u);
});

test("account room layout stacks on small windows and room title truncates", async () => {
  const css = await read("styles/parts/202-room-navigation.css");
  assert.match(css, /grid-template-columns: minmax\(260px, 480px\) minmax\(0, 1fr\)/u);
  assert.match(css, /@media \(max-width: 1000px\)/u);
  assert.match(css, /@container \(max-width: 780px\)/u);
  assert.match(css, /font-variant-numeric: tabular-nums/u);
  assert.match(
    await read("components/layout/TopStatusBar.tsx"),
    /<span className="truncate">\{room\.roomName\}/u,
  );
});
