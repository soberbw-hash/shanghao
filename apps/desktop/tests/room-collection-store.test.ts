import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { RoomCollectionItem } from "@private-voice/shared";

import { RoomCollectionStore } from "../../../packages/signaling/src/room-collection-store";

const makeItem = (index: number): RoomCollectionItem => ({
  id: `item-${index}`,
  kind: index % 2 === 0 ? "link" : "text",
  title: `珍藏 ${index}`,
  content: index % 2 === 0 ? `https://example.com/${index}` : `固定好友留言 ${index}`,
  createdByPeerId: "peer-owner",
  createdByNickname: "Sober",
  createdAt: new Date(Date.UTC(2026, 7, 2, 0, 0, index)).toISOString(),
});

test("room collection persists all items and restores from backup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-collection-"));
  const filePath = path.join(directory, "room-collection.json");

  try {
    const store = await RoomCollectionStore.create(filePath);
    for (let index = 0; index < 31; index += 1) {
      store.add("main", makeItem(index));
    }
    await store.flush();

    const persisted = await readFile(filePath, "utf8");
    assert.equal(persisted.charCodeAt(0) === 0xfeff, false);
    assert.equal(store.get("main").length, 31);
    assert.equal(store.get("main")[0]?.id, "item-0");

    store.remove("main", "item-1");
    await store.flush();
    assert.equal(
      store.get("main").some((item) => item.id === "item-1"),
      false,
    );

    await writeFile(filePath, "{broken-json", "utf8");
    const restored = await RoomCollectionStore.create(filePath);
    // The atomic backup is the previous complete snapshot, before the latest removal.
    assert.equal(restored.get("main").length, 31);
    assert.equal(restored.get("main")[0]?.id, "item-0");
    assert.equal(
      restored.get("main").some((item) => item.id === "item-1"),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
