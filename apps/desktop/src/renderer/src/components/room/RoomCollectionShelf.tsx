import { Archive, Gamepad2, Image, Link2, StickyNote } from "lucide-react";

import type { RoomCollectionItem } from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import {
  readRoomCollectionDragPayload,
  ROOM_COLLECTION_DRAG_TYPE,
  type RoomCollectionDragPayload,
} from "../../features/chat/collectionDrag";

interface RoomCollectionShelfProps {
  items: RoomCollectionItem[];
  isOpen: boolean;
  isDragOver: boolean;
  hasUnreadItems: boolean;
  onOpen: () => void;
  onDragOverChange: (value: boolean) => void;
  onSaveDragged: (payload: RoomCollectionDragPayload) => void;
}

const CollectionObject = ({ item }: { item: RoomCollectionItem }) => {
  if (item.kind === "image") {
    return (
      <span className="room-collection-object is-image" title={item.title}>
        <img src={item.content} alt="" draggable={false} />
        <Image aria-hidden="true" />
      </span>
    );
  }

  if (item.kind === "text") {
    return (
      <span className="room-collection-object is-note" title={item.title}>
        <StickyNote aria-hidden="true" />
      </span>
    );
  }

  if (item.kind === "game") {
    return (
      <span className="room-collection-object is-game" title={item.title}>
        <Gamepad2 aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="room-collection-object is-link" title={item.title}>
      <Link2 aria-hidden="true" />
    </span>
  );
};

export const RoomCollectionShelf = ({
  items,
  isOpen,
  isDragOver,
  hasUnreadItems,
  onOpen,
  onDragOverChange,
  onSaveDragged,
}: RoomCollectionShelfProps) => {
  const visibleItems = items.slice(-6);
  const upperItems = visibleItems.slice(-3);
  const lowerItems = visibleItems.slice(-6, -3);
  const itemCountLabel = `${items.length} 条房间收藏`;

  return (
    <div className="room-collection-shelf-position">
      <button
        type="button"
        className={cn("room-collection-shelf", isOpen && "is-open", isDragOver && "is-drop-target")}
        aria-label={`打开${itemCountLabel}`}
        aria-pressed={isOpen}
        onClick={onOpen}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes(ROOM_COLLECTION_DRAG_TYPE)) return;
          event.preventDefault();
          onDragOverChange(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(ROOM_COLLECTION_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          onDragOverChange(true);
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
          onDragOverChange(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const payload = readRoomCollectionDragPayload(event.dataTransfer);
          onDragOverChange(false);
          if (payload) onSaveDragged(payload);
        }}
      >
        <span className="room-collection-shelf-shadow" aria-hidden="true" />
        <span className="room-collection-shelf-body" aria-hidden="true">
          <span className="room-collection-shelf-top" />
          <span className="room-collection-shelf-display">
            {upperItems.length ? (
              upperItems.map((item) => <CollectionObject key={item.id} item={item} />)
            ) : (
              <span className="room-collection-empty-objects">
                <span />
                <span />
                <span />
              </span>
            )}
          </span>
          <span className="room-collection-shelf-board" />
          <span className="room-collection-shelf-display is-lower">
            {lowerItems.length ? (
              lowerItems.map((item) => <CollectionObject key={item.id} item={item} />)
            ) : (
              <span className="room-collection-decorative-books">
                <span />
                <span />
              </span>
            )}
          </span>
          <span className="room-collection-shelf-base" />
          <span className="room-collection-drop-feedback">
            <Archive />
            <span>松开放入</span>
          </span>
        </span>
        {hasUnreadItems ? (
          <span className="room-collection-shelf-unread" aria-label="有新收藏" />
        ) : null}
        <span className="room-collection-shelf-tooltip">
          {isDragOver
            ? "松开放入收藏"
            : visibleItems.length
              ? itemCountLabel
              : "把消息拖到书架收藏"}
        </span>
      </button>
    </div>
  );
};
