import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  enqueueToast,
  toastStackDepth,
} from "../src/renderer/src/features/notifications/toastQueue";
import type { ToastMessage } from "../src/renderer/src/store/appStore";

test("changing knock countdown merges into one stable notification with the latest copy", () => {
  let queue: ToastMessage[] = [];
  for (let seconds = 3; seconds >= 1; seconds--) {
    queue = enqueueToast(
      queue,
      {
        dedupeKey: "knock-cooldown",
        title: "刚刚已经敲过啦",
        description: `${seconds} 秒后可以再敲一次。`,
      },
      `id-${seconds}`,
    );
  }
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, "id-3");
  assert.equal(queue[0].description, "1 秒后可以再敲一次。");
  assert.equal(queue[0].repeatCount, 3);
  assert.equal(toastStackDepth(queue), 3);
});

test("ordinary duplicates merge, distinct descriptions and actions do not", () => {
  const action = () => undefined;
  let queue = enqueueToast([], { title: "saved" }, "one");
  queue = enqueueToast(queue, { title: "saved", tone: "neutral" }, "two");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].repeatCount, 2);
  queue = enqueueToast(queue, { title: "saved", description: "different" }, "three");
  queue = enqueueToast(
    queue,
    { title: "saved", actionLabel: "open", onAction: action, persistent: true },
    "four",
  );
  assert.deepEqual(
    queue.map((toast) => toast.id),
    ["one", "three", "four"],
  );
  queue = enqueueToast(
    queue,
    { title: "saved", actionLabel: "open", onAction: action, persistent: true },
    "five",
  );
  assert.equal(queue[2].id, "four");
  assert.equal(queue[2].repeatCount, 2);
});

test("bounded newest-first stack retains the latest three distinct notices", () => {
  let queue: ToastMessage[] = [];
  for (let index = 0; index < 8; index++)
    queue = enqueueToast(queue, { title: `${index}` }, `${index}`);
  assert.deepEqual(
    queue.map((toast) => toast.id),
    ["5", "6", "7"],
  );
  assert.equal(toastStackDepth([]), 0);
  assert.equal(toastStackDepth([queue[0]]), 1);
  assert.equal(toastStackDepth(queue), 3);
  queue = enqueueToast(queue, { title: "5" }, "new-id");
  assert.equal(queue.at(-1)?.id, "5");
});

test("shared toast surface exposes expansion and keeps rear layers decorative", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/components/layout/ToastRegion.tsx", import.meta.url),
    "utf8",
  );
  const room = await readFile(
    new URL("../src/renderer/src/pages/RoomPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /ordered\.slice\(0, 1\)/);
  assert.match(source, /toast\.actionLabel && toast\.onAction/);
  assert.match(room, /dedupeKey: "knock-cooldown"/);
});
