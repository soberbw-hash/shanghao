import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const readSource = (file: string): string =>
  readFileSync(path.resolve(process.cwd(), file), "utf8");

test("semantic UI sound engine stays bounded, routed, and free of hover or typing noise", () => {
  const packageJson = JSON.parse(readSource("package.json")) as {
    dependencies?: Record<string, string>;
  };
  const source = readSource("src/renderer/src/features/audio/uiSound.ts");

  assert.equal(packageJson.dependencies?.uisfx, "0.4.0");
  assert.equal(source.includes("createUISFX"), true);
  assert.equal(source.includes("maxVoices: 6"), true);
  assert.equal(source.includes("setSinkId"), true);
  assert.equal(source.includes("playGenericPressUnlessHandled"), true);
  assert.equal(source.includes('"mic-on": { cue: "toggle-on", pack: "soft"'), true);
  assert.equal(source.includes('"speaker-muted": { cue: "lock", pack: "soft"'), true);
  assert.equal(source.includes("deviceToggle: 0.075"), true);
  assert.equal(source.includes('"hover"'), false);
  assert.equal(source.includes('"typing"'), false);
  assert.equal(source.match(/\.wav/g)?.length, 1);
});

test("major flows expose semantic motion and state feedback instead of isolated samples", () => {
  const account = readSource("src/renderer/src/pages/AccountPage.tsx");
  const settings = readSource("src/renderer/src/pages/SettingsPage.tsx");
  const models = readSource("src/renderer/src/components/settings/AiVoiceMemorySettingsCard.tsx");
  const voiceMemory = readSource("src/renderer/src/components/settings/VoiceMemoryDetail.tsx");
  const recording = readSource(
    "src/renderer/src/components/settings/RecordingLibrarySettingsCard.tsx",
  );
  const styles = readSource("src/renderer/src/styles/parts/160-sensory-polish.css");

  assert.equal(account.includes('layoutId="account-active-tab"'), true);
  assert.equal(account.includes("account-avatar-check"), true);
  assert.equal(account.includes('playUiSound("account-success")'), true);
  assert.equal(settings.includes('layoutId="settings-active-section"'), true);
  assert.equal(settings.includes("contentRef"), true);
  assert.equal(settings.includes('playUiSound("settings-section")'), true);
  assert.equal(models.includes("data-model-phase"), true);
  assert.equal(models.includes('playUiSound("model-complete")'), true);
  assert.equal(voiceMemory.includes('playUiSound("transcription-complete")'), true);
  assert.equal(recording.includes("recording-detail-swap"), true);
  assert.equal(styles.includes(".is-visual-runtime-hidden"), true);
  assert.equal(styles.includes("prefers-reduced-motion: reduce"), false);
  assert.equal(styles.includes("inset 3px 0 0"), false);
});
