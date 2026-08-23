import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRenderer = (relativePath: string) =>
  readFileSync(new URL(`../src/renderer/src/${relativePath}`, import.meta.url), "utf8");

const visualStyles = readRenderer("styles/parts/140-visual-experience.css");
const characterStyles = readRenderer("styles/parts/50-character.css");

test("weather completes sunlight, plant shadows, snow and staggered city lights", () => {
  const weather = readRenderer("components/room/DynamicWeatherWindow.tsx");

  assert.match(weather, /weather-sunbeam/);
  assert.match(weather, /weather-city-lights/);
  assert.match(weather, /weather-plant-shadow-left/);
  assert.match(weather, /weather-plant-shadow-right/);
  assert.match(visualStyles, /@keyframes weather-sunbeam-drift/);
  assert.match(visualStyles, /@keyframes weather-city-light-twinkle/);
  assert.match(visualStyles, /\.weather-scene-snow \.weather-window-sill::after/);
});

test("animated room lighting overscans the scene edge without exposing an uncolored strip", () => {
  assert.match(
    visualStyles,
    /\.scene-window-light \{[^}]*left: -4%;[^}]*width: 43%;[^}]*room-window-light-drift/s,
  );
});

test("character life is coordinated and includes expressive and connection feedback", () => {
  const personality = readRenderer("features/voice-scene/characterPersonality.ts");
  const scheduler = readRenderer("features/voice-scene/useCoordinatedIdleActions.ts");
  const character = readRenderer("components/room/SceneCharacter.tsx");

  for (const action of ['"blink"', '"ear"', '"yawn"'])
    assert.match(personality, new RegExp(action));
  assert.match(scheduler, /2 - active\.size/);
  assert.match(character, /room-character-reconnect-steps/);
  assert.match(character, /room-character-update-device/);
  assert.doesNotMatch(visualStyles, /\.desk-animal-speaking \.desk-animal-art/);
  assert.match(characterStyles, /\.desk-animal-speaking \.desk-animal-head/);
  assert.match(visualStyles, /character-moving-shadow/);
});

test("glass highlights follow the pointer without a perpetual sweep", () => {
  const highlight = readRenderer("features/motion/glassPointerHighlight.ts");
  const topbar = readRenderer("components/layout/TopStatusBar.tsx");
  const dock = readRenderer("components/room/RoomDock.tsx");

  assert.match(highlight, /--glass-pointer-x/);
  assert.match(topbar, /onPointerMove/);
  assert.match(dock, /onPointerMove/);
  assert.doesNotMatch(visualStyles, /glass-highlight-pass/);
  assert.match(visualStyles, /\.room-page \.voice-dock\s*\{[^}]*overflow: visible;/s);
  assert.match(visualStyles, /\.room-page \.voice-dock::after[\s\S]*border-radius: inherit;/);
});

test("screen sharing unfolds from the selected source and supports ambient and immersive feedback", () => {
  const panel = readRenderer("components/room/ScreenSharePanel.tsx");
  const picker = readRenderer("components/room/RoomOverlays.tsx");
  const viewer = readRenderer("pages/ScreenShareViewerPage.tsx");

  assert.match(picker, /getBoundingClientRect/);
  assert.match(panel, /sampleMediaAmbientColor/);
  assert.match(panel, /screen-share-quality-notice/);
  assert.match(panel, /is-source-unfolding/);
  assert.match(panel, /exit=\{\{ opacity: 0, scale: 0\.9, y: 8 \}\}/);
  assert.match(viewer, /requestFullscreen/);
  assert.match(viewer, /has-hidden-controls/);
  assert.match(visualStyles, /@keyframes screen-share-source-unfold/);
  assert.match(visualStyles, /\.screen-share-viewer-toolbar/);
});

test("recording, markers, speaker closure and AI work all expose visible state feedback", () => {
  const room = readRenderer("pages/RoomPage.tsx");
  const topbar = readRenderer("components/layout/TopStatusBar.tsx");
  const voiceMemory = readRenderer("components/settings/VoiceMemoryDetail.tsx");

  assert.match(room, /isRecording=\{recordingStatus\.state === RecordingState\.Recording\}/);
  assert.match(topbar, /room-recording-live/);
  assert.match(topbar, /room-recording-marker-pulse/);
  assert.match(room, /is-speaker-closed/);
  assert.match(voiceMemory, /voice-memory-audio-trajectory/);
  assert.match(visualStyles, /@keyframes room-recording-breathe/);
  assert.match(visualStyles, /@keyframes room-recording-marker-confirm/);
  assert.match(visualStyles, /@keyframes voice-memory-wave/);
});
