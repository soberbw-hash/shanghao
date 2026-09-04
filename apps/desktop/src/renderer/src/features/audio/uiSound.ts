import { createUISFX, type CueName, type PackName, type UISFXPlayer } from "uisfx";

import { writeRendererLog } from "../../utils/logger";

export type UiSound =
  | "button-click"
  | "enter-room"
  | "leave-room"
  | "member-join"
  | "member-leave"
  | "knock-bell"
  | "popup-open"
  | "copy-success"
  | "device-switch"
  | "send-message"
  | "receive-message"
  | "connection-restored"
  | "connection-failed"
  | "mic-error"
  | "record-start"
  | "record-stop"
  | "record-marker"
  | "mic-on"
  | "mic-off"
  | "speaker-muted"
  | "speaker-unmuted"
  | "settings-section"
  | "screen-share-start"
  | "screen-share-stop"
  | "model-queued"
  | "model-checkpoint"
  | "model-complete"
  | "transcription-start"
  | "transcription-complete"
  | "process-error"
  | "account-success";

interface UiSoundRecipe {
  cue: CueName;
  pack: PackName;
  volume: number;
  cooldownMs?: number;
}

// These gains are tuned for perceived loudness, not raw peak equality. Short tactile
// toggles need less gain than wide, soft notifications to sound equally present.
const uiGain = {
  subtle: 0.09,
  standard: 0.11,
  important: 0.13,
  // Entering a room can coincide with the first remote PCM frame. Keep this
  // cue deliberately below normal UI feedback so the two never stack into a pop.
  roomEntry: 0.025,
  deviceToggle: 0.075,
} as const;

type SinkRoutableAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type SinkRoutableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const soundRecipes: Record<Exclude<UiSound, "knock-bell">, UiSoundRecipe> = {
  "button-click": { cue: "press", pack: "studio", volume: uiGain.subtle, cooldownMs: 70 },
  // Room entry is played right as remote audio becomes available. Keep it soft and
  // avoid the organic pack's bright transient so it never jumps out of the speakers.
  "enter-room": { cue: "wake", pack: "soft", volume: uiGain.roomEntry, cooldownMs: 250 },
  "leave-room": { cue: "sleep", pack: "organic", volume: uiGain.standard, cooldownMs: 250 },
  "member-join": { cue: "connect", pack: "organic", volume: uiGain.standard, cooldownMs: 220 },
  "member-leave": { cue: "disconnect", pack: "organic", volume: uiGain.standard, cooldownMs: 220 },
  "popup-open": { cue: "open", pack: "glass", volume: uiGain.standard, cooldownMs: 90 },
  "copy-success": { cue: "copy", pack: "glass", volume: uiGain.standard, cooldownMs: 120 },
  "device-switch": { cue: "connect", pack: "studio", volume: uiGain.standard, cooldownMs: 160 },
  "send-message": { cue: "send", pack: "glass", volume: uiGain.standard, cooldownMs: 180 },
  "receive-message": { cue: "receive", pack: "soft", volume: uiGain.standard, cooldownMs: 240 },
  "connection-restored": {
    cue: "connect",
    pack: "scifi",
    volume: uiGain.important,
    cooldownMs: 600,
  },
  "connection-failed": { cue: "error", pack: "studio", volume: uiGain.important, cooldownMs: 600 },
  "mic-error": { cue: "blocked", pack: "studio", volume: uiGain.standard, cooldownMs: 400 },
  "record-start": { cue: "start", pack: "studio", volume: uiGain.standard, cooldownMs: 260 },
  "record-stop": { cue: "stop", pack: "studio", volume: uiGain.standard, cooldownMs: 260 },
  "record-marker": { cue: "checkpoint", pack: "studio", volume: uiGain.standard, cooldownMs: 160 },
  "mic-on": { cue: "toggle-on", pack: "soft", volume: uiGain.deviceToggle, cooldownMs: 120 },
  "mic-off": { cue: "toggle-off", pack: "soft", volume: uiGain.deviceToggle, cooldownMs: 120 },
  "speaker-muted": { cue: "lock", pack: "soft", volume: uiGain.deviceToggle, cooldownMs: 120 },
  "speaker-unmuted": { cue: "unlock", pack: "soft", volume: uiGain.deviceToggle, cooldownMs: 120 },
  "settings-section": { cue: "select", pack: "soft", volume: uiGain.subtle, cooldownMs: 80 },
  "screen-share-start": {
    cue: "connect",
    pack: "scifi",
    volume: uiGain.important,
    cooldownMs: 260,
  },
  "screen-share-stop": {
    cue: "disconnect",
    pack: "scifi",
    volume: uiGain.standard,
    cooldownMs: 260,
  },
  "model-queued": { cue: "queued", pack: "dreamy", volume: uiGain.subtle, cooldownMs: 300 },
  "model-checkpoint": {
    cue: "checkpoint",
    pack: "glass",
    volume: uiGain.standard,
    cooldownMs: 300,
  },
  "model-complete": { cue: "complete", pack: "dreamy", volume: uiGain.important, cooldownMs: 500 },
  "transcription-start": { cue: "start", pack: "scifi", volume: uiGain.standard, cooldownMs: 300 },
  "transcription-complete": {
    cue: "success",
    pack: "glass",
    volume: uiGain.important,
    cooldownMs: 400,
  },
  "process-error": { cue: "error", pack: "soft", volume: uiGain.important, cooldownMs: 400 },
  "account-success": { cue: "success", pack: "dreamy", volume: uiGain.important, cooldownMs: 400 },
};

const preloadSounds: readonly Exclude<UiSound, "knock-bell">[] = [
  "button-click",
  "popup-open",
  "send-message",
  "receive-message",
  "mic-on",
  "mic-off",
  "record-start",
  "record-stop",
  "model-complete",
];

const knockUrl = new URL("../../assets/sounds/knock-bell.wav", import.meta.url).href;

let player: UISFXPlayer | undefined;
let audioContext: SinkRoutableAudioContext | undefined;
let knockTemplate: SinkRoutableAudioElement | undefined;
const masterVolume = 0.72;
let preferredOutputDeviceId: string | undefined;
let lastSemanticSoundAt = 0;
let didLogSinkFailureForDevice: string | undefined;

const normalizeSinkId = (deviceId?: string): string =>
  !deviceId || deviceId === "default" ? "" : deviceId;

const routeElementToPreferredOutput = async (audio: SinkRoutableAudioElement): Promise<void> => {
  if (typeof audio.setSinkId !== "function") return;
  await audio.setSinkId(normalizeSinkId(preferredOutputDeviceId));
};

const routeContextToPreferredOutput = async (): Promise<boolean> => {
  if (!audioContext) return true;
  if (typeof audioContext.setSinkId !== "function") {
    return !preferredOutputDeviceId || preferredOutputDeviceId === "default";
  }
  try {
    await audioContext.setSinkId(normalizeSinkId(preferredOutputDeviceId));
    didLogSinkFailureForDevice = undefined;
    return true;
  } catch (error) {
    const deviceKey = preferredOutputDeviceId ?? "default";
    if (didLogSinkFailureForDevice !== deviceKey) {
      didLogSinkFailureForDevice = deviceKey;
      void writeRendererLog("audio", "warn", "ui_sound_output_route_failed", {
        preferredOutputDeviceId: deviceKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  }
};

const ensurePlayer = (): UISFXPlayer | undefined => {
  if (player) return player;
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return undefined;
  try {
    audioContext = new window.AudioContext({
      latencyHint: "interactive",
    }) as SinkRoutableAudioContext;
    player = createUISFX({
      context: audioContext,
      pack: "studio",
      volume: masterVolume,
      enabled: true,
      maxVoices: 6,
      cooldownMs: 40,
    });
    void routeContextToPreferredOutput();
    return player;
  } catch (error) {
    void writeRendererLog("audio", "warn", "ui_sound_runtime_initialization_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
};

const ensureKnockTemplate = (): SinkRoutableAudioElement | undefined => {
  if (knockTemplate) return knockTemplate;
  try {
    const audio = new Audio(knockUrl) as SinkRoutableAudioElement;
    audio.preload = "auto";
    audio.load();
    knockTemplate = audio;
    void routeElementToPreferredOutput(audio).catch(() => undefined);
    return audio;
  } catch {
    return undefined;
  }
};

const playBrandKnock = (): void => {
  const template = ensureKnockTemplate();
  if (!template) return;
  const playback = template.cloneNode(true) as SinkRoutableAudioElement;
  playback.volume = Math.min(1, 0.34 * masterVolume);
  void routeElementToPreferredOutput(playback)
    .catch(() => undefined)
    .then(() => playback.play())
    .catch(() => undefined);
};

export const setUiSoundOutputDevice = async (deviceId?: string): Promise<boolean> => {
  preferredOutputDeviceId = deviceId;
  const routedContext = await routeContextToPreferredOutput();
  if (knockTemplate) {
    try {
      await routeElementToPreferredOutput(knockTemplate);
    } catch {
      return false;
    }
  }
  return routedContext;
};

export const unlockUiSounds = async (): Promise<boolean> => {
  const activePlayer = ensurePlayer();
  if (!activePlayer) return false;
  const unlocked = await activePlayer.unlock();
  if (unlocked) await routeContextToPreferredOutput();
  return unlocked;
};

export const prepareUiSounds = (): void => {
  const activePlayer = ensurePlayer();
  ensureKnockTemplate();
  if (!activePlayer) return;
  const cues = [...new Set(preloadSounds.map((sound) => soundRecipes[sound].cue))];
  void activePlayer.preload(cues);
};

export const playUiSound = (sound: UiSound): void => {
  if (sound !== "button-click") lastSemanticSoundAt = performance.now();
  try {
    if (sound === "knock-bell") {
      playBrandKnock();
      return;
    }
    const recipe = soundRecipes[sound];
    const activePlayer = ensurePlayer();
    if (!activePlayer) return;
    activePlayer.setPack(recipe.pack);
    activePlayer.play(recipe.cue, {
      volume: recipe.volume,
      cooldownMs: recipe.cooldownMs,
      retrigger: sound === "receive-message" ? "overlap" : "restart",
    });
  } catch {
    // UI feedback must never block room, recording, or signaling work.
  }
};

export const playGenericPressUnlessHandled = (clickStartedAt: number): void => {
  if (lastSemanticSoundAt >= clickStartedAt) return;
  playUiSound("button-click");
};

export const stopAllUiSounds = (): void => {
  player?.stopAll();
};
