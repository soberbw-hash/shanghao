import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ChatMessage } from "@private-voice/shared";

import { ChatHistoryStore } from "../src/main/chat-history-store";

const message = (id: string, content = id): ChatMessage => ({
  id,
  peerId: "peer-one",
  nickname: "朋友",
  content,
  createdAt: `2026-08-11T00:00:${id.padStart(2, "0")}.000Z`,
});

test("chat history survives a new store instance and stays isolated by room", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-chat-history-"));
  try {
    const firstStore = new ChatHistoryStore(directory);
    await firstStore.save("wss://voice.example/|main", [message("1")]);
    await firstStore.save("wss://voice.example/|side", [message("2")]);

    const reloadedStore = new ChatHistoryStore(directory);
    assert.deepEqual(
      (await reloadedStore.read("wss://voice.example/|main")).map((item) => item.id),
      ["1"],
    );
    assert.deepEqual(
      (await reloadedStore.read("wss://voice.example/|side")).map((item) => item.id),
      ["2"],
    );
    const persisted = JSON.parse(
      await readFile(path.join(directory, "chat-history.json"), "utf8"),
    ) as { version: number };
    assert.equal(persisted.version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("chat history de-duplicates messages and keeps the latest 500", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-chat-history-"));
  try {
    const store = new ChatHistoryStore(directory);
    const messages = Array.from({ length: 510 }, (_, index) => ({
      ...message(String(index).padStart(3, "0")),
      createdAt: new Date(Date.UTC(2026, 7, 11, 0, 0, index)).toISOString(),
    }));
    await store.save("wss://voice.example/|main", [...messages, messages[509]!]);
    const restored = await store.read("wss://voice.example/|main");
    assert.equal(restored.length, 500);
    assert.equal(restored[0]?.id, "010");
    assert.equal(restored.at(-1)?.id, "509");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
