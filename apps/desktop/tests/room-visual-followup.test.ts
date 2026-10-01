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
test("quick-message header is an inset rounded card instead of a clipped divider", () => {
  const css = source("styles/parts/190-room-glass-unification.css");
  const chat = source("components/chat/TemporaryChatPanel.tsx");
  assert.match(
    css,
    /\.room-page \.chat-panel-header\s*\{[^}]*margin-inline: 2px;[^}]*border: 1px solid[^;]*;[^}]*border-radius: 16px;/s,
  );
  assert.doesNotMatch(css, /\.room-page \.chat-panel-header\s*\{[^}]*border-bottom:/s);
  assert.ok(chat.includes('className="relative min-h-0 flex-1"'));
});
test("scene window art can paint above its coordinate canvas", () => {
  const css = source("styles/parts/130-final-material.css");
  assert.match(css, /\.team-island-stage\s*\{[^}]*contain: layout;/s);
  assert.doesNotMatch(css, /\.team-island-stage\s*\{[^}]*contain: layout paint;/s);
});
test("dock and segmented audio controls share the outer corner radius", () => {
  const css = source("styles/parts/190-room-glass-unification.css");
  assert.match(
    css,
    /\.room-page \.voice-dock\s*\{[^}]*border-radius: var\(--room-dock-corner-radius\)/s,
  );
  assert.match(
    css,
    /\.room-page \.voice-segmented-control \.voice-segmented-main\s*\{[^}]*border-top-left-radius: var\(--room-dock-corner-radius\)/s,
  );
  assert.match(
    css,
    /\.room-page \.voice-segmented-control \.voice-segmented-arrow\s*\{[^}]*border-top-right-radius: var\(--room-dock-corner-radius\)/s,
  );
});
test("local account presets and names survive incoming presence", () => {
  const hook = source("hooks/useRoomState.ts");
  assert.ok(hook.includes("nickname: accountSnapshot.profile?.displayName"));
  assert.ok(source("features/room/memberProjection.ts").includes("nickname: profile?.displayName"));
  assert.ok(
    source("features/room/memberProjection.ts").includes("settings?.accountAvatarPresetId"),
  );
  assert.ok(source("app/App.tsx").includes("accountProfileAvatarSource(accountSnapshot.profile)"));
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
  assert.ok(weather.includes('theme.hasClouds || theme.scene === "clear"'));
  assert.ok(weather.includes("weather-cloud-three"));
  assert.ok(weather.includes("weather-sky-breath"));
  assert.ok(weather.includes("weather-near-foliage"));
  assert.ok(weather.includes("weather-night-details"));
  assert.ok(weather.includes("weather-night-city-glimmer"));
  const sceneLife = source("styles/parts/205-scene-life.css");
  assert.match(sceneLife, /\.weather-night-star\s*\{/);
  assert.match(sceneLife, /\.weather-cloud-layer\s*\{[^}]*container-type: inline-size/s);
  assert.match(sceneLife, /\.scene-ceiling-curtain\s*\{[^}]*animation: scene-curtain-breathe/s);
  assert.match(sceneLife, /\.scene-foreground-leaves\s*\{[^}]*animation: scene-foreground-sway/s);
  assert.match(sceneLife, /\.scene-corner-pet-ear\s*\{[^}]*animation: scene-pet-ear-flick/s);
  assert.match(sceneLife, /\.team-island\.is-visual-motion-paused \.scene-ceiling-curtain/);
  const roomGlass = source("styles/parts/190-room-glass-unification.css");
  const roomAssets = source("styles/parts/180-room-asset-pass.css");
  assert.match(roomAssets, /\.scene-window-nook\s*\{[^}]*top: -11\.5%/);
  for (const ratio of ["29 / 20", "8 / 5", "19 / 10", "11 / 5"])
    assert.ok(roomAssets.includes(`@container room-scene (min-aspect-ratio: ${ratio})`));
  assert.match(
    roomAssets,
    /@container room-scene \(min-aspect-ratio: 17 \/ 10\)\s*\{\s*\.room-date-calendar,\s*\.scene-wall-clock\s*\{\s*top: 7%/,
  );
  assert.doesNotMatch(roomGlass, /\.scene-window-nook\s*\{/);
  assert.match(roomGlass, /weather-cloud-window-passage/);
  assert.match(roomGlass, /translate3d\(145cqw, -4px, 0\)/);
});
