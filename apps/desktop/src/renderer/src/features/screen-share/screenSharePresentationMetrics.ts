import type { ScreenSharePresentationStats } from "./ScreenSharePipelineController";

const presentationByPeerId = new Map<string, ScreenSharePresentationStats>();
const MAX_PRESENTATION_PEERS = 16;
const PRESENTATION_STALE_MS = 5_000;

export const recordScreenSharePresentation = (
  peerId: string,
  stats: ScreenSharePresentationStats,
): void => {
  if (!presentationByPeerId.has(peerId) && presentationByPeerId.size >= MAX_PRESENTATION_PEERS) {
    const oldestPeerId = presentationByPeerId.keys().next().value;
    if (oldestPeerId) presentationByPeerId.delete(oldestPeerId);
  }
  presentationByPeerId.delete(peerId);
  presentationByPeerId.set(peerId, stats);
};

export const readScreenSharePresentation = (
  now = Date.now(),
): Record<string, ScreenSharePresentationStats> => {
  for (const [peerId, stats] of presentationByPeerId) {
    if (now - stats.sampledAt > PRESENTATION_STALE_MS) presentationByPeerId.delete(peerId);
  }
  return Object.fromEntries(presentationByPeerId);
};

export const clearScreenSharePresentation = (peerId?: string): void => {
  if (peerId) presentationByPeerId.delete(peerId);
  else presentationByPeerId.clear();
};
