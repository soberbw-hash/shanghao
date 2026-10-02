import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACCOUNT_AVATAR_PRESET_IDS, accountAvatarPresetForIdentity } from "@private-voice/shared";
import { randomRoomAvatar } from "../src/renderer/src/features/room/randomRoomAvatar";
import {
  rememberRoomDirectory,
  seed,
} from "../src/renderer/src/features/room/privateRoomDirectoryCache";
import { RecordingMarkerCue } from "../src/renderer/src/components/settings/RecordingMarkerCue";

test("fresh room sessions draw all five characters and avoid consecutive repetition", () => {
  const original = Math.random;
  const seen = new Set<string>();
  try {
    for (let index = 0; index < 100; index++) {
      Math.random = () => (index % 4) / 4;
      const avatar = randomRoomAvatar("fox");
      assert.notEqual(avatar, [...seen].at(-1));
      seen.delete(avatar);
      seen.add(avatar);
    }
    assert.equal(seen.size, 5);
  } finally {
    Math.random = original;
  }
});

test("avatar IPC retains built-in identity and expanded fallback remains compatible", () => {
  const ipc = readFileSync("src/main/ipc.ts", "utf8");
  assert.match(
    ipc,
    /accountAvatarPresetId:\s*request\?\.accountAvatarPresetId && isAccountAvatarPresetId/,
  );
  assert.equal(ACCOUNT_AVATAR_PRESET_IDS.length, 32);
  for (const identity of ["sober", "legacy-user", "中文账号", "123"]) {
    assert.ok(
      ACCOUNT_AVATAR_PRESET_IDS.slice(0, 10).includes(accountAvatarPresetForIdentity(identity)),
    );
  }
});

test("game marker cue appears only near the recorded event", () => {
  const markers = [
    {
      id: "m",
      createdAt: new Date(0).toISOString(),
      offsetMs: 12_000,
      label: "12:26 启动了英雄联盟",
    },
  ];
  const render = (currentTime: number) =>
    renderToStaticMarkup(
      createElement(RecordingMarkerCue, { markers, currentTime, duration: 100 }),
    );
  assert.match(render(12), /12:26 启动了英雄联盟/);
  assert.equal(render(20), "");
});

test("home is primed before navigation and directory cache is scoped to account and server", () => {
  const hook = readFileSync("src/renderer/src/hooks/useRoomState.ts", "utf8");
  assert.ok(
    hook.indexOf("rememberRoomDirectory(") <
      hook.indexOf('useAppStore.getState().navigate("room")'),
  );
  const empty = seed(JSON.stringify(["a", "wss://example.com"]));
  const room = {
    roomId: "private:test",
    name: "一起玩",
    channelCode: "123456",
    onlineCount: 1,
    capacity: 5,
  };
  rememberRoomDirectory(
    "a",
    "wss://example.com",
    room as Parameters<typeof rememberRoomDirectory>[2],
  );
  const saved = seed(empty.scope);
  assert.equal(saved.loading, false);
  assert.equal(saved.history.recent[0]?.name, "一起玩");
  assert.equal(seed(JSON.stringify(["b", "wss://example.com"])).history.recent.length, 0);
  assert.equal(seed(JSON.stringify(["a", "wss://other.com"])).history.recent.length, 0);
});
