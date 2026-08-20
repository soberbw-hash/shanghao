import type { ScreenSharePresentationStats } from "./ScreenSharePipelineController";

const presentationByPeerId = new Map<string, ScreenSharePresentationStats>();

export const recordScreenSharePresentation = (
  peerId: string,
  stats: ScreenSharePresentationStats,
): void => {
  presentationByPeerId.set(peerId, stats);
};

export const readScreenSharePresentation = (
  now = Date.now(),
): Record<string, ScreenSharePresentationStats> =>
  Object.fromEntries(
    [...presentationByPeerId].filter(([, stats]) => now - stats.sampledAt <= 5_000),
  );

export const clearScreenSharePresentation = (peerId?: string): void => {
  if (peerId) presentationByPeerId.delete(peerId);
  else presentationByPeerId.clear();
};
