import type { RoomCollectionItemKind } from "@private-voice/shared";

export const ROOM_COLLECTION_DRAG_TYPE = "application/x-shanghao-room-collection";

export interface RoomCollectionDragPayload {
  kind: Extract<RoomCollectionItemKind, "text" | "link" | "image">;
  title: string;
  content: string;
}

export const writeRoomCollectionDragPayload = (
  transfer: DataTransfer,
  payload: RoomCollectionDragPayload,
): void => {
  transfer.effectAllowed = "copy";
  transfer.setData(ROOM_COLLECTION_DRAG_TYPE, JSON.stringify(payload));
  transfer.setData("text/plain", payload.content);
};

export const readRoomCollectionDragPayload = (
  transfer: DataTransfer,
): RoomCollectionDragPayload | undefined => {
  const serialized = transfer.getData(ROOM_COLLECTION_DRAG_TYPE);
  if (!serialized) return undefined;
  try {
    const payload = JSON.parse(serialized) as Partial<RoomCollectionDragPayload>;
    if (
      !payload.kind ||
      !["text", "link", "image"].includes(payload.kind) ||
      typeof payload.title !== "string" ||
      !payload.title.trim() ||
      typeof payload.content !== "string" ||
      !payload.content.trim()
    ) {
      return undefined;
    }
    return {
      kind: payload.kind,
      title: payload.title.trim().slice(0, 80),
      content: payload.content.trim(),
    } as RoomCollectionDragPayload;
  } catch {
    return undefined;
  }
};
