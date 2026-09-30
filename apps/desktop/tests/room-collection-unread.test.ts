import assert from "node:assert/strict";
import test from "node:test";

import type { RoomCollectionItem } from "@private-voice/shared";

import {
  collectionLastViewedAt,
  newestOtherCollectionItemAt,
} from "../src/renderer/src/features/chat/collectionUnread";

const item = (
  createdByPeerId: string,
  createdAt: string,
  createdByProfileId?: string,
): RoomCollectionItem => ({
  id: `${createdByPeerId}-${createdAt}`,
  kind: "text",
  title: "测试收藏",
  content: "测试收藏",
  createdByPeerId,
  createdByProfileId,
  createdByNickname: "朋友",
  createdAt,
});

test("rejoining with a new Peer ID does not mark one's own collection item as new", () => {
  const items = [
    item("previous-session", "2026-09-30T00:04:00.000Z", "stable-profile"),
    item("friend", "2026-09-30T00:03:00.000Z", "friend-profile"),
  ];
  assert.equal(
    newestOtherCollectionItemAt(items, "current-session", "stable-profile"),
    Date.parse("2026-09-30T00:03:00.000Z"),
  );
});

test("only newer items added by another member can raise the collection badge", () => {
  const viewedAt = Date.parse("2026-09-30T00:00:00.000Z");
  const items = [
    item("friend", "2026-09-29T23:59:00.000Z"),
    item("self", "2026-09-30T00:02:00.000Z"),
    item("friend", "2026-09-30T00:01:00.000Z"),
  ];
  assert.equal(newestOtherCollectionItemAt(items, "self") > viewedAt, true);
  assert.equal(newestOtherCollectionItemAt(items.slice(0, 2), "self") > viewedAt, false);
});

test("viewed time is tracked independently for the two rooms with legacy fallback", () => {
  const legacy = "2026-09-30T00:00:00.000Z";
  const byRoom = { main: "2026-09-30T00:05:00.000Z" };
  assert.equal(collectionLastViewedAt("main", byRoom, legacy), Date.parse(byRoom.main));
  assert.equal(collectionLastViewedAt("side", byRoom, legacy), Date.parse(legacy));
  assert.equal(collectionLastViewedAt("main", { main: "invalid" }), 0);
});
