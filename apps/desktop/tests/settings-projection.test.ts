import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { shallow } from "zustand/shallow";
import type { AppSettings } from "@private-voice/shared";
import {
  selectAppProfileSettings,
  selectCollectionSettings,
  selectOverlaySettings,
} from "../src/renderer/src/features/settings/settingsProjection";

test("profile, collection and overlays ignore unrelated settings and preserve hydration", () => {
  const settings = {
    nickname: "test",
    avatarId: "cat",
    hasCompletedProfileSetup: true,
    collectionViewedAtByRoom: { "room-a": "2026-10-01T00:00:00Z" },
    lastDailyRoomReportSeen: { "room-a": "2026-09-30" },
    lastReleaseNotesVersionSeen: "3.4.0",
  } as AppSettings;
  for (const select of [
    selectAppProfileSettings,
    selectCollectionSettings,
    selectOverlaySettings,
  ]) {
    assert.equal(select({}), undefined);
    const initial = select({ settings });
    assert.equal(
      shallow(initial, select({ settings: { ...settings, speakerMasterVolume: 0.15 } })),
      true,
    );
  }
  assert.equal(
    shallow(
      selectAppProfileSettings({ settings }),
      selectAppProfileSettings({ settings: { ...settings, nickname: "updated" } }),
    ),
    false,
  );
  assert.equal(
    shallow(
      selectCollectionSettings({ settings }),
      selectCollectionSettings({
        settings: { ...settings, collectionViewedAtByRoom: { "room-a": "2026-10-02T00:00:00Z" } },
      }),
    ),
    false,
  );
  assert.equal(
    shallow(
      selectOverlaySettings({ settings }),
      selectOverlaySettings({ settings: { ...settings, lastReleaseNotesVersionSeen: "next" } }),
    ),
    false,
  );
});

test("room and persistent views no longer subscribe to the entire settings object", async () => {
  for (const file of [
    "hooks/useRoomState.ts",
    "hooks/useRoomCollection.ts",
    "app/App.tsx",
    "pages/SharedOverlays.tsx",
  ]) {
    const source = await readFile(new URL(`../src/renderer/src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /useSettingsStore\(\(state\) => state\.settings\)/u);
  }
  const room = await readFile(
    new URL("../src/renderer/src/hooks/useRoomState.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(room, /getState\(\)\.settings \?\? settings/u);
});

test("chat recall is outside metadata flow, fades at the edge and stays keyboard accessible", async () => {
  const css = await readFile(
    new URL("../src/renderer/src/styles/parts/65-chat-affordances.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /calc\(100% - 20px\)/u);
  assert.match(css, /padding-bottom: 24px/u);
  assert.match(css, /\.chat-message-recall-button \{\s*position: absolute/u);
  assert.match(css, /\.chat-message-row:focus-within/u);
  assert.match(css, /@media \(hover: none\)/u);
});
