import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { accountAvatarPresetForIdentity } from "@private-voice/shared";
import { AccountAvatarPresetStore } from "../../../packages/signaling/src/account-avatar-preset-store";

test("legacy accounts receive a stable cloud portrait and explicit choices survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shanghao-avatar-test-"));
  const file = join(directory, "account-avatar-presets.json");
  try {
    const store = await AccountAvatarPresetStore.create(file);
    const [first, concurrent] = await Promise.all([
      store.getOrAssign("account-1"),
      store.getOrAssign("account-1"),
    ]);
    assert.equal(first, accountAvatarPresetForIdentity("account-1"));
    assert.equal(concurrent, first);
    await store.set("account-1", "peach-fox");
    assert.equal(store.get("account-1"), "peach-fox");

    const persisted = JSON.parse(await readFile(file, "utf8")) as {
      version: number;
      avatars: Record<string, string>;
    };
    assert.equal(persisted.version, 1);
    assert.ok(!JSON.stringify(persisted).includes("account-1"));
    assert.deepEqual(Object.values(persisted.avatars), ["peach-fox"]);

    const reopened = await AccountAvatarPresetStore.create(file);
    assert.equal(await reopened.getOrAssign("account-1"), "peach-fox");
    assert.equal(reopened.get("account-2"), undefined);
  } finally {
    if (directory.startsWith(tmpdir())) await rm(directory, { recursive: true, force: true });
  }
});

test("an unconfigured server does not claim an explicit avatar was saved", async () => {
  const store = await AccountAvatarPresetStore.create();
  assert.equal(await store.getOrAssign("account-1"), accountAvatarPresetForIdentity("account-1"));
  await assert.rejects(store.set("account-1", "peach-fox"), /not_configured/);
});
