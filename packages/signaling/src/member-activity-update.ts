import type { MemberStateMessage } from "./protocol";

/** Normalize only the member's public activity fields; unrelated patches retain the current game. */
export function normalizeMemberActivity(message: MemberStateMessage, previousGame?: string) {
  const gameName = message.gameName?.trim() || undefined;
  const currentGame = message.gameName === undefined ? previousGame : gameName;
  return {
    gameName,
    gameIconDataUrl: message.gameIconDataUrl,
    gameSession: currentGame === "英雄联盟" ? message.gameSession : null,
    musicActivity: message.musicActivity
      ? {
          provider: message.musicActivity.provider,
          providerName: message.musicActivity.providerName.trim().slice(0, 32),
          trackTitle: message.musicActivity.trackTitle.trim().slice(0, 160),
          artist: message.musicActivity.artist?.trim().slice(0, 100) || undefined,
        }
      : message.musicActivity === null
        ? null
        : undefined,
  };
}
