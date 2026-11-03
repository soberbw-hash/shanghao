import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CloudAiAdminStore } from "../../../packages/signaling/src/cloud-ai-admin-store";

test("admin mutations persist secrets without returning them, preserve blank keys and reject concurrent revisions", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-admin-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "providers.json");
  const store = await CloudAiAdminStore.open(file, { CLOUD_AI_API_KEY: "private-key" });
  assert.equal(JSON.stringify(store.snapshot()).includes("private-key"), false);
  const saved = await store.mutate({
    action: "save",
    revision: 0,
    provider: {
      id: "builtin-text",
      kind: "text",
      name: "文本",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "model-a",
      apiKey: "",
    },
  });
  assert.equal(store.provider("text")?.apiKey, "private-key");
  assert.equal(saved.revision, 1);
  await assert.rejects(
    store.mutate({ action: "disable", id: "builtin-text", revision: 0 }),
    /conflict/,
  );
  const competing = await Promise.allSettled([
    store.mutate({ action: "disable", id: "builtin-text", revision: 1 }),
    store.mutate({ action: "delete", id: "builtin-text", revision: 1 }),
  ]);
  assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(store.provider("text"), undefined);
  const reopened = await CloudAiAdminStore.open(file, { CLOUD_AI_API_KEY: "other-key" });
  assert.deepEqual(reopened.snapshot(), store.snapshot());
  assert.equal(JSON.stringify(reopened.snapshot()).includes("private-key"), false);
  assert.equal((await readFile(file + ".previous", "utf8")).includes("private-key"), true);
});

test("unsupported URLs and damaged storage never silently replace working configuration", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-admin-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "providers.json");
  const store = await CloudAiAdminStore.open(file, {});
  for (const baseUrl of [
    "http://127.0.0.1",
    "https://localhost",
    "https://open.bigmodel.cn.evil.invalid",
    "https://user:pass@open.bigmodel.cn",
    "https://open.bigmodel.cn:8080",
    "https://open.bigmodel.cn/?key=secret",
  ]) {
    await assert.rejects(
      store.mutate({
        action: "save",
        revision: 0,
        provider: { kind: "text", name: "test", baseUrl, model: "test", apiKey: "secret" },
      }),
    );
  }
  assert.equal(store.snapshot().revision, 0);
  await writeFile(file, "damaged", { mode: 0o600 });
  await assert.rejects(CloudAiAdminStore.open(file), /storage_invalid/);
  assert.equal(await readFile(file, "utf8"), "damaged");
});
