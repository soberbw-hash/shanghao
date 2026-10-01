import type { RoomCollectionItem } from "@private-voice/shared";
import type { RoomCollectionSnapshotMessage } from "./protocol";
const ROOM_COLLECTION_PAYLOAD_BUDGET_BYTES = 248 * 1024;
const ROOM_COLLECTION_CHUNK_SIZE = 128;

export function buildRoomCollectionSnapshots(
  roomId: string,
  items: RoomCollectionItem[],
): RoomCollectionSnapshotMessage[] {
  if (items.length === 0) {
    return [{ type: "room_collection_snapshot", roomId, items: [], replace: true }];
  }

  const snapshots: RoomCollectionSnapshotMessage[] = [];
  let chunk: RoomCollectionItem[] = [];

  const flush = (): void => {
    if (chunk.length === 0) return;
    snapshots.push({
      type: "room_collection_snapshot",
      roomId,
      items: chunk,
      replace: snapshots.length === 0,
    });
    chunk = [];
  };

  for (const item of items) {
    const candidate = [...chunk, item];
    const payload = JSON.stringify({
      type: "room_collection_snapshot",
      roomId,
      items: candidate,
      replace: snapshots.length === 0,
    });
    if (
      chunk.length > 0 &&
      (candidate.length > ROOM_COLLECTION_CHUNK_SIZE ||
        Buffer.byteLength(payload, "utf8") > ROOM_COLLECTION_PAYLOAD_BUDGET_BYTES)
    ) {
      flush();
    }
    chunk.push(item);
  }
  flush();
  return snapshots;
}
