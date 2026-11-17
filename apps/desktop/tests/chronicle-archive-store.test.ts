import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ChronicleArchiveStore } from "../src/main/chronicle-archive-store";

const entry = (id: string) => ({ id, at: 1234, text: "合成纪事：甲刚说稳了，乙就开始找退路。" });
test("chronicle archive survives reopening, deduplicates, and isolates account/server/room scopes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-chronicle-archive-"));
  let scope = "account-a|server-a";
  try {
    const store = new ChronicleArchiveStore(root, () => scope);
    await Promise.all([
      store.append("room-a", [entry("one")]),
      store.append("room-a", [entry("two")]),
    ]);
    await store.append("room-a", [entry("one")]);
    await store.react("room-a", "one", "funny");
    assert.equal((await new ChronicleArchiveStore(root, () => scope).read("room-a")).length, 2);
    assert.equal((await store.append("room-a", [entry("one")]))[0]?.reaction, "funny");
    assert.deepEqual(await store.read("room-b"), []);
    scope = "account-b|server-a";
    assert.deepEqual(await store.read("room-a"), []);
    scope = "account-a|server-b";
    assert.deepEqual(await store.read("room-a"), []);
    scope = "account-a|server-a";
    await assert.rejects(store.append("room-a", [{ ...entry("one"), text: "不能覆盖旧纪事" }]));
    assert.equal((await store.read("room-a"))[0]?.text, entry("one").text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("damaged and unknown archives are retained byte-for-byte and never overwritten", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-chronicle-damaged-"));
  try {
    const store = new ChronicleArchiveStore(root, () => "scope");
    await store.append("room", [entry("one")]);
    const file = path.join(root, (await readdir(root))[0]!);
    for (const contents of ['{"version":2}', "{broken"]) {
      await writeFile(file, contents);
      await assert.rejects(store.append("room", [entry("two")]));
      assert.equal(await readFile(file, "utf8"), contents);
    }
    await assert.rejects(store.append("room", [{ ...entry("bad"), at: -1 }]));
    await assert.rejects(store.read("../outside"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("queued archive operations cannot read a changed account's data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-chronicle-scope-"));
  let scope = "first";
  try {
    const store = new ChronicleArchiveStore(root, () => scope);
    const pending = store.append("room", [entry("one")]);
    scope = "second";
    await assert.rejects(pending, /scope_changed/);
    assert.deepEqual(await store.read("room"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
