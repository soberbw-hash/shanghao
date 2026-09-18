import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(`src/renderer/src/${path}`, "utf8");
test("calendar dates sit on a blank material asset, not an opaque cover", () => {
  assert.ok(source("components/room/RoomDateCalendar.tsx").includes("calendar-blank-v2.png"));
  const css = source("styles/parts/180-room-asset-pass.css");
  assert.match(
    css,
    /\.room-date-calendar:hover \.room-date-calendar-paper\s*\{[^}]*background: transparent/s,
  );
});
test("seat numbers stay below characters and desk tint excludes live screens", () => {
  assert.ok(
    source("components/room/TeamIsland.tsx").includes(
      "scene-seat-markers pointer-events-none absolute inset-0 z-[19]",
    ),
  );
  const css = source("styles/parts/180-room-asset-pass.css");
  assert.match(css, /\.scene-workstation-art\s*\{[^}]*brightness\(0\.91\)/s);
  assert.match(
    css,
    /\.scene-workstation\.is-current \.scene-workstation-art-frame\s*\{[^}]*filter: drop-shadow/s,
  );
});
test("chat settings live in the title row, outside quick replies", () => {
  const chat = source("components/chat/TemporaryChatPanel.tsx");
  assert.ok(
    chat.indexOf('className="chat-settings-button') < chat.indexOf('className="chat-quick-actions'),
  );
  assert.ok(chat.includes("chat-panel-title-row flex items-center justify-between"));
});
test("local account presets and names survive incoming presence", () => {
  const hook = source("hooks/useRoomState.ts");
  assert.ok(hook.includes("nickname: accountSnapshot.profile?.displayName"));
  assert.ok(hook.includes("nickname: useAccountStore.getState().snapshot.profile?.displayName"));
  assert.ok(hook.includes("settings?.accountAvatarPresetId"));
  assert.ok(source("app/App.tsx").includes("preset.id === settings.accountAvatarPresetId"));
});
test("generated weather retains live effects and visibility/reduced-motion gating", () => {
  const weather = source("components/room/DynamicWeatherWindow.tsx");
  for (const name of ["day", "cloudy", "rain", "snow", "night"]) {
    assert.ok(existsSync(`src/renderer/src/assets/scenes/shanghao-room/weather-${name}.png`));
    assert.ok(weather.includes(`weather-${name}.png`));
  }
  for (const effect of ["rain", "snow", "fog", "cloud"])
    assert.ok(weather.includes(`weather-${effect}-layer`));
  assert.ok(weather.includes("reduceMotion || !isPageVisible"));
  assert.ok(weather.includes("window-frame-v2.png"));
});
