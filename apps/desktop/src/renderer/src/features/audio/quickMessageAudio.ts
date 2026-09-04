import type { BuiltInAvatarId, QuickMessageMediaType } from "@private-voice/shared";

import { playAnimalCall } from "./animalCall";
import { QUICK_MESSAGE_SOUND_URLS } from "./quickMessageAssets";

export type QuickMessageAudioStatus = "idle" | "playing" | "paused";

export interface QuickMessageAudioSnapshot {
  soundId?: string;
  mediaType?: QuickMessageMediaType;
  status: QuickMessageAudioStatus;
  sourcePeerId?: string;
  sourceNickname?: string;
  quickMessageId?: string;
  presetId?: string;
  content?: string;
}

export interface QuickMessagePlaybackSource {
  peerId?: string;
  nickname?: string;
  messageId?: string;
  presetId?: string;
  content?: string;
}

const activePlayers = new Set<HTMLAudioElement>();
const audioListeners = new Set<() => void>();
let activePlayer: HTMLAudioElement | undefined;
let activeSoundId: string | undefined;
let activeMediaType: QuickMessageMediaType | undefined;
let activeSourcePeerId: string | undefined;
let activeSourceNickname: string | undefined;
let activeQuickMessageId: string | undefined;
let activePresetId: string | undefined;
let activeContent: string | undefined;
let activeStatus: QuickMessageAudioStatus = "idle";
let activeObjectUrl: string | undefined;
let activePlayerReady = false;
let playbackGeneration = 0;
let audioSnapshot: QuickMessageAudioSnapshot = { status: "idle" };

const notifyAudioListeners = (): void => {
  for (const listener of audioListeners) listener();
};

const publishAudioSnapshot = (): void => {
  audioSnapshot = {
    soundId: activeSoundId,
    mediaType: activeMediaType,
    status: activeStatus,
    sourcePeerId: activeSourcePeerId,
    sourceNickname: activeSourceNickname,
    quickMessageId: activeQuickMessageId,
    presetId: activePresetId,
    content: activeContent,
  };
  notifyAudioListeners();
};

export const getQuickMessageAudioSnapshot = (): QuickMessageAudioSnapshot => audioSnapshot;

export const subscribeQuickMessageAudio = (listener: () => void): (() => void) => {
  audioListeners.add(listener);
  return () => audioListeners.delete(listener);
};

const clearActivePlayer = (player?: HTMLAudioElement): void => {
  if (player && activePlayer !== player) return;
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = undefined;
  }
  activePlayerReady = false;
  activePlayer = undefined;
  activeSoundId = undefined;
  activeMediaType = undefined;
  activeSourcePeerId = undefined;
  activeSourceNickname = undefined;
  activeQuickMessageId = undefined;
  activePresetId = undefined;
  activeContent = undefined;
  activeStatus = "idle";
  publishAudioSnapshot();
};

const stopActivePlayers = (): void => {
  playbackGeneration += 1;
  for (const player of activePlayers) {
    player.pause();
    player.currentTime = 0;
    activePlayers.delete(player);
  }
  clearActivePlayer();
};

const playLocalVoicePack = (
  url: string,
  volume: number,
  soundId: string,
  mediaType: QuickMessageMediaType,
  source?: QuickMessagePlaybackSource,
): void => {
  stopActivePlayers();
  const generation = playbackGeneration;
  const player = new Audio();
  player.preload = "auto";
  // Keep the custom AAC protocol on the native media path and honor the user's
  // volume setting. The bundled packs are peak-safe at the asset level.
  player.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
  activePlayers.add(player);
  activePlayer = player;
  activeSoundId = soundId;
  activeMediaType = mediaType;
  activeSourcePeerId = source?.peerId;
  activeSourceNickname = source?.nickname;
  activeQuickMessageId = source?.messageId;
  activePresetId = source?.presetId;
  activeContent = source?.content;
  activeStatus = "playing";
  publishAudioSnapshot();
  player.addEventListener(
    "ended",
    () => {
      activePlayers.delete(player);
      clearActivePlayer(player);
    },
    { once: true },
  );
  player.addEventListener(
    "error",
    () => {
      activePlayers.delete(player);
      clearActivePlayer(player);
    },
    { once: true },
  );
  void (async () => {
    try {
      if (mediaType === "music") {
        // Chromium can treat a custom-protocol AAC Range response as the end of
        // the media when it reaches the first requested segment. Music is
        // small enough to buffer as one immutable local asset, which also
        // keeps the dedicated music player independent from short SFX logic.
        const response = await fetch(url, { cache: "force-cache" });
        if (!response.ok) throw new Error(`quick_music_fetch_${response.status}`);
        const bytes = await response.arrayBuffer();
        if (generation !== playbackGeneration || activePlayer !== player) return;
        activeObjectUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/aac" }));
        player.src = activeObjectUrl;
      } else {
        player.src = url;
      }
      if (generation !== playbackGeneration || activePlayer !== player) return;
      player.load();
      activePlayerReady = true;
      if (activeStatus !== "playing") return;
      await player.play();
    } catch {
      // Keep a direct-source fallback for environments that reject fetches for
      // the private media scheme; it still uses the same player lifecycle.
      if (generation !== playbackGeneration || activePlayer !== player) return;
      if (mediaType === "music" && activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
        activeObjectUrl = undefined;
      }
      player.src = url;
      player.load();
      activePlayerReady = true;
      if (activeStatus !== "playing") return;
      await player.play().catch(() => {
        activePlayers.delete(player);
        clearActivePlayer(player);
      });
    }
  })().catch(() => {
    activePlayers.delete(player);
    clearActivePlayer(player);
  });
};

export const toggleQuickMessageMusic = (soundId: string | undefined): boolean => {
  if (!soundId || activeMediaType !== "music" || activeSoundId !== soundId || !activePlayer) {
    return false;
  }
  if (activeStatus === "playing") {
    activePlayer.pause();
    activeStatus = "paused";
    publishAudioSnapshot();
    return true;
  }
  const player = activePlayer;
  if (!player) return false;
  if (!activePlayerReady) {
    activeStatus = "playing";
    publishAudioSnapshot();
    return true;
  }
  activeStatus = "playing";
  publishAudioSnapshot();
  void player.play().catch(() => clearActivePlayer(player));
  return true;
};

/** Stops the active music on this client without changing any other listener's playback. */
export const stopQuickMessageMusic = (soundId?: string): boolean => {
  if (!activePlayer || activeMediaType !== "music" || (soundId && activeSoundId !== soundId)) {
    return false;
  }
  stopActivePlayers();
  return true;
};

/** Stops only the currently audible remote music for this local listener. */
export const muteQuickMessagePlayback = (source: {
  peerId?: string;
  messageId?: string;
}): boolean => {
  if (
    !activePlayer ||
    activeMediaType !== "music" ||
    (source.peerId && activeSourcePeerId !== source.peerId) ||
    (source.messageId && activeQuickMessageId !== source.messageId)
  ) {
    return false;
  }
  stopActivePlayers();
  return true;
};

/** Plays a local preset sound without putting the audio bytes into signaling messages. */
export const playQuickMessageSound = (
  soundId: string | undefined,
  avatarId: BuiltInAvatarId | undefined,
  volume: number,
  content: string,
  mediaType: QuickMessageMediaType = "voice",
  source?: QuickMessagePlaybackSource,
): void => {
  if (soundId === "legacy-animal-call") {
    stopActivePlayers();
    playAnimalCall(avatarId, volume, content);
    return;
  }
  const url = soundId ? QUICK_MESSAGE_SOUND_URLS[soundId] : undefined;
  if (url && soundId) {
    playLocalVoicePack(url, volume, soundId, mediaType, { ...source, content });
  }
};
