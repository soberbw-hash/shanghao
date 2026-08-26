import type { BuiltInAvatarId } from "@private-voice/shared";

import { playAnimalCall } from "./animalCall";
import { QUICK_MESSAGE_SOUND_URLS } from "./quickMessageAssets";

const activeVoicePlayers = new Set<HTMLAudioElement>();

const playLocalVoicePack = (url: string, volume: number): void => {
  const player = new Audio(url);
  player.volume = Math.min(1, Math.max(0, volume));
  activeVoicePlayers.add(player);
  player.addEventListener("ended", () => activeVoicePlayers.delete(player), { once: true });
  void player.play().catch(() => activeVoicePlayers.delete(player));
};

/** Plays a local preset sound without putting the audio bytes into signaling messages. */
export const playQuickMessageSound = (
  soundId: string | undefined,
  avatarId: BuiltInAvatarId | undefined,
  volume: number,
  content: string,
): void => {
  if (soundId === "legacy-animal-call") {
    playAnimalCall(avatarId, volume, content);
    return;
  }
  const url = soundId ? QUICK_MESSAGE_SOUND_URLS[soundId] : undefined;
  if (url) playLocalVoicePack(url, volume);
};
