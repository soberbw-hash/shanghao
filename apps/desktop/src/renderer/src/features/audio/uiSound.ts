import { createUISFX, type CueName, type PackName, type PlayingSFX, type UISFXPlayer } from "uisfx";

import { writeRendererLog } from "../../utils/logger";
import { waitForVisualIdle } from "../visual-runtime/waitForVisualIdle";
import { loadRoomEntryCue, loadRoomMemberJoinCue } from "./roomEntryCue";

export type UiSound =
  | "button-click"
  | "enter-room"
  | "leave-room"
  | "member-join"
  | "member-leave"
  | "away"
  | "return"
  | "member-away"
  | "member-return"
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
  | "muted-speech-reminder"
  | "speaker-muted"
  | "speaker-unmuted"
  | "phone-mode-enter"
  | "phone-mode-exit"
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
  playbackRate?: number;
}

// Use unity application gain; Windows output and per-app volume control loudness.
// Cue synthesis retains its own envelope, so unity gain is not peak normalization.
const uiGain = {
  subtle: 1,
  standard: 1,
  important: 1,
  roomEntry: 1,
  deviceToggle: 1,
} as const;

type SinkRoutableAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

type SinkRoutableAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const soundRecipes: Record<Exclude<UiSound, "knock-bell">, UiSoundRecipe> = {
  "button-click": { cue: "press", pack: "studio", volume: uiGain.subtle, cooldownMs: 70 },
  // Keep the soft entry cue; playback gain follows the same policy as other cues.
  "enter-room": { cue: "wake", pack: "soft", volume: uiGain.roomEntry, cooldownMs: 250 },
  "leave-room": { cue: "sleep", pack: "organic", volume: uiGain.standard, cooldownMs: 250 },
  "member-join": { cue: "connect", pack: "organic", volume: uiGain.standard, cooldownMs: 220 },
  "member-leave": { cue: "disconnect", pack: "organic", volume: uiGain.standard, cooldownMs: 220 },
  away: { cue: "sleep", pack: "soft", volume: uiGain.standard, cooldownMs: 250 },
  return: { cue: "wake", pack: "soft", volume: uiGain.standard, cooldownMs: 250 },
  "member-away": { cue: "sleep", pack: "soft", volume: uiGain.subtle, cooldownMs: 250 },
  "member-return": { cue: "wake", pack: "soft", volume: uiGain.subtle, cooldownMs: 250 },
  "popup-open": { cue: "press", pack: "studio", volume: uiGain.standard, cooldownMs: 90 },
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
  "muted-speech-reminder": { cue: "blocked", pack: "soft", volume: 0.18, cooldownMs: 60_000 },
  "speaker-muted": { cue: "lock", pack: "soft", volume: uiGain.deviceToggle, cooldownMs: 120 },
  "speaker-unmuted": { cue: "unlock", pack: "soft", volume: uiGain.deviceToggle, cooldownMs: 120 },
  "phone-mode-enter": {
    cue: "double-click",
    pack: "soft",
    volume: 0.6,
    playbackRate: 1.6,
    cooldownMs: 180,
  },
  "phone-mode-exit": {
    cue: "toggle-off",
    pack: "soft",
    volume: 0.6,
    playbackRate: 1.6,
    cooldownMs: 180,
  },
  "settings-section": { cue: "press", pack: "studio", volume: uiGain.subtle, cooldownMs: 80 },
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
  "enter-room",
  "member-join",
  "button-click",
  "record-start",
  "popup-open",
  "leave-room",
  "member-leave",
  "away",
  "return",
  "send-message",
  "receive-message",
  "mic-on",
  "mic-off",
  "record-stop",
  "model-complete",
];

const knockUrl = new URL("../../assets/sounds/knock-bell.wav", import.meta.url).href;

const players = new Map<PackName, UISFXPlayer>();
const activeSounds: PlayingSFX[] = [];
const entryGains = new Set<GainNode>();
type RoomFeedbackSound = "enter-room" | "member-join";
const roomFeedbackPlaybacks = new Map<RoomFeedbackSound, PlayingSFX>();
let entryCueRevision = 0;
let memberCueRevision = 0;
let lastMemberCueAt = -Infinity;
let lastEntryCueAt = -Infinity;
export const cancelDelayedRoomEntryCue = (): void => {
  entryCueRevision++;
  memberCueRevision++;
};
let prepared = false;
let feedbackEnabled = true;
let feedbackRevision = 0;
let latestResumeRequest = 0;
let resumePromise: Promise<void> | undefined;
let audioContext: SinkRoutableAudioContext | undefined;
let knockTemplate: SinkRoutableAudioElement | undefined;
let masterVolume = 1;
export const setUiSoundVolume = (volume: number): void => {
  if (!Number.isFinite(volume)) return;
  masterVolume = Math.max(0, Math.min(1, volume));
  players.forEach((player) => player.setVolume(masterVolume));
  entryGains.forEach((gain) => {
    gain.gain.value = masterVolume * uiGain.roomEntry;
  });
};
export const setUiSoundFeedbackEnabled = (enabled: boolean): void => {
  if (feedbackEnabled === enabled) return;
  feedbackEnabled = enabled;
  feedbackRevision++;
  if (!enabled) stopAllUiSounds();
};
let preferredOutputDeviceId: string | undefined;
let lastSemanticSoundAt = 0;
let didLogSinkFailureForDevice: string | undefined;
let routedSinkId: string | undefined;
let outputRoutePromise: Promise<void> | undefined;

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
  while (outputRoutePromise) await outputRoutePromise.catch(() => undefined);
  const sinkId = normalizeSinkId(preferredOutputDeviceId);
  if (routedSinkId === sinkId) return true;
  let route: Promise<void> | undefined;
  try {
    route = audioContext.setSinkId(sinkId);
    outputRoutePromise = route;
    await route;
    routedSinkId = sinkId;
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
  } finally {
    if (outputRoutePromise === route) outputRoutePromise = undefined;
  }
};

const ensurePlayer = (pack: PackName = "studio"): UISFXPlayer | undefined => {
  const existing = players.get(pack);
  if (existing) return existing;
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") return undefined;
  try {
    if (!audioContext) {
      audioContext = new window.AudioContext({
        latencyHint: "interactive",
      }) as SinkRoutableAudioContext;
      void routeContextToPreferredOutput();
    }
    const player = createUISFX({
      context: audioContext,
      pack,
      volume: masterVolume,
      enabled: true,
      maxVoices: 6,
      cooldownMs: 40,
    });
    players.set(pack, player);
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
  playback.volume = masterVolume;
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

export const prepareUiSounds = async (signal = new AbortController().signal): Promise<void> => {
  if (prepared) return;
  await waitForVisualIdle(signal, 1_200);
  const activePlayer = ensurePlayer();
  ensureKnockTemplate();
  if (!activePlayer || prepared) return;
  prepared = true;
  try {
    // Synthesis is synchronous inside UISFX. Never warm several packs in parallel.
    for (const sound of preloadSounds) {
      await waitForVisualIdle(signal);
      const recipe = soundRecipes[sound];
      if (sound === "enter-room" && audioContext) await loadRoomEntryCue(audioContext);
      else if (sound === "member-join" && audioContext) await loadRoomMemberJoinCue(audioContext);
      else await ensurePlayer(recipe.pack)?.preload([recipe.cue], { signal });
      signal.throwIfAborted();
    }
  } catch (error) {
    prepared = false;
    throw error;
  }
};

const retainPlayback = (playback: PlayingSFX): void => {
  if (activeSounds.includes(playback)) return;
  activeSounds.push(playback);
  if (activeSounds.length > 2) activeSounds.shift()?.stop();
  void playback.ended.then(() => {
    const index = activeSounds.indexOf(playback);
    if (index >= 0) activeSounds.splice(index, 1);
  });
};

const playRoomFeedbackCue = (sound: RoomFeedbackSound): void => {
  const context = audioContext;
  if (!context) return;
  const requestedAt = performance.now();
  const isEntry = sound === "enter-room";
  // A member snapshot arriving with our own entry belongs to the same feedback
  // episode. Later members still get their ordinary join cue.
  const entryPlaying = () =>
    roomFeedbackPlaybacks.has("enter-room") || performance.now() - lastEntryCueAt < 250;
  if (!isEntry && entryPlaying()) return;
  if (requestedAt - (isEntry ? lastEntryCueAt : lastMemberCueAt) < (isEntry ? 250 : 220)) return;
  if (isEntry) {
    lastEntryCueAt = requestedAt;
    memberCueRevision++;
    roomFeedbackPlaybacks.get("member-join")?.stop();
  } else lastMemberCueAt = requestedAt;
  const revision = isEntry ? ++entryCueRevision : ++memberCueRevision;
  const feedback = feedbackRevision;
  void (isEntry ? loadRoomEntryCue(context) : loadRoomMemberJoinCue(context))
    .then(({ buffer }) => {
      if (
        !feedbackEnabled ||
        feedback !== feedbackRevision ||
        revision !== (isEntry ? entryCueRevision : memberCueRevision) ||
        (!isEntry && entryPlaying()) ||
        context.state !== "running" ||
        performance.now() - requestedAt > 250
      )
        return;
      const source = context.createBufferSource();
      roomFeedbackPlaybacks.get(sound)?.stop();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = masterVolume * uiGain.roomEntry;
      source.connect(gain);
      gain.connect(context.destination);
      entryGains.add(gain);
      const ended = new Promise<void>((resolve) =>
        source.addEventListener(
          "ended",
          () => {
            source.disconnect();
            gain.disconnect();
            entryGains.delete(gain);
            if (roomFeedbackPlaybacks.get(sound) === playback) roomFeedbackPlaybacks.delete(sound);
            resolve();
          },
          { once: true },
        ),
      );
      let stopped = false;
      const playback = {
        stop: () => {
          if (!stopped) {
            stopped = true;
            source.stop();
          }
        },
        ended,
      };
      roomFeedbackPlaybacks.set(sound, playback);
      retainPlayback(playback);
      source.start();
    })
    .catch(() => undefined);
};

export const playUiSound = (sound: UiSound): void => {
  if (!feedbackEnabled) return;
  if (sound !== "button-click") lastSemanticSoundAt = performance.now();
  try {
    if (sound === "knock-bell") {
      playBrandKnock();
      return;
    }
    const recipe = soundRecipes[sound];
    const activePlayer = ensurePlayer(recipe.pack);
    if (!activePlayer) return;
    if (audioContext?.state !== "running") {
      // A suspended context used to accumulate sources at audio time zero and
      // release them together on unlock. Retain only one fresh cue, never a backlog.
      const request = ++latestResumeRequest;
      const revision = feedbackRevision;
      const entryRevision = entryCueRevision;
      const memberRevision = memberCueRevision;
      const requestedAt = performance.now();
      resumePromise ??= audioContext?.resume().finally(() => {
        resumePromise = undefined;
      });
      void resumePromise
        ?.then(() => {
          if (
            feedbackEnabled &&
            revision === feedbackRevision &&
            (sound !== "enter-room" || entryRevision === entryCueRevision) &&
            (sound !== "member-join" || memberRevision === memberCueRevision) &&
            request === latestResumeRequest &&
            performance.now() - requestedAt < 250 &&
            audioContext?.state === "running"
          )
            playUiSound(sound);
        })
        .catch(() => undefined);
      return;
    }
    if (sound === "enter-room" || sound === "member-join") {
      playRoomFeedbackCue(sound);
      return;
    }
    const playback = activePlayer.play(recipe.cue, {
      volume: recipe.volume,
      playbackRate: recipe.playbackRate,
      cooldownMs: recipe.cooldownMs,
      retrigger: sound === "receive-message" ? "overlap" : "restart",
    });
    if (playback) retainPlayback(playback);
  } catch {
    // UI feedback must never block room, recording, or signaling work.
  }
};

export const playGenericPressUnlessHandled = (clickStartedAt: number): void => {
  if (lastSemanticSoundAt >= clickStartedAt) return;
  playUiSound("button-click");
};

export const stopAllUiSounds = (): void => {
  cancelDelayedRoomEntryCue();
  players.forEach((player) => player.stopAll());
  activeSounds.forEach((playback) => playback.stop());
  activeSounds.length = 0;
};
