import type { RoomCollectionItem } from "@private-voice/shared";

type RoomId = string;

export const collectionLastViewedAt = (
  roomId: RoomId,
  viewedAtByRoom?: Partial<Record<RoomId, string>>,
  legacyViewedAt?: string,
): number => {
  const value = viewedAtByRoom?.[roomId] ?? legacyViewedAt;
  return value ? Date.parse(value) || 0 : 0;
};

export const newestOtherCollectionItemAt = (
  items: readonly RoomCollectionItem[],
  localMemberId?: string,
  localProfileId?: string,
): number =>
  items.reduce(
    (latest, item) =>
      item.createdByPeerId === localMemberId ||
      (localProfileId && item.createdByProfileId === localProfileId)
        ? latest
        : Math.max(latest, Date.parse(item.createdAt) || 0),
    0,
  );
