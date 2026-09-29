import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CustomAiProviderStore } from "../src/main/custom-ai-provider-store";

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value, "utf8"),
  decryptString: (value: Buffer) => value.toString("utf8"),
};

test("custom AI credentials retain the key across edits and refuse to overwrite damaged data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-custom-ai-"));
  const filePath = path.join(root, "ai", "custom-provider.enc");
  try {
    const store = new CustomAiProviderStore(undefined, root, storage);
    assert.equal((await store.status()).configured, false);
    await store.save({ baseUrl: "https://8.8.8.8", model: "first", apiKey: "test-key" });
    await store.save({ baseUrl: "https://8.8.8.8", model: "second" });
    const saved = JSON.parse(await readFile(filePath, "utf8")) as {
      model: string;
      apiKey: string;
    };
    assert.equal(saved.model, "second");
    assert.equal(saved.apiKey, "test-key");
    assert.deepEqual(await readdir(path.dirname(filePath)), ["custom-provider.enc"]);

    await writeFile(filePath, "damaged encrypted bytes", "utf8");
    await assert.rejects(store.status(), /custom_ai_config_unreadable/);
    await assert.rejects(
      store.save({ baseUrl: "https://8.8.8.8", model: "replacement", apiKey: "new-key" }),
      /custom_ai_config_unreadable/,
    );
    assert.equal(await readFile(filePath, "utf8"), "damaged encrypted bytes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("custom AI credentials distinguish an unreadable path from a missing file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-custom-ai-read-"));
  try {
    const store = new CustomAiProviderStore(undefined, root, storage);
    assert.equal((await store.status()).configured, false);
    await mkdir(path.join(root, "ai", "custom-provider.enc"), { recursive: true });
    await assert.rejects(store.status());
    await assert.rejects(
      store.save({ baseUrl: "https://8.8.8.8", model: "test", apiKey: "new-key" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
