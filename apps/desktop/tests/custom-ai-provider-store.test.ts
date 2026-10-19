import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promises as dns } from "node:dns";

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

test("changing provider origin requires an explicit key and preserves the original vault on failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-custom-ai-origin-"));
  const filePath = path.join(root, "ai", "custom-provider.enc");
  try {
    const store = new CustomAiProviderStore(undefined, root, storage);
    await store.save({ baseUrl: "https://8.8.8.8/v1", model: "first", apiKey: "old-test-key" });
    await store.save({ baseUrl: "https://8.8.8.8/v2", model: "second" });
    const original = await readFile(filePath);
    for (const baseUrl of ["https://8.8.4.4", "https://8.8.8.8:444/v2"]) {
      await assert.rejects(
        store.save({ baseUrl, model: "third", apiKey: "  " }),
        /custom_ai_key_required/,
      );
      assert.deepEqual(await readFile(filePath), original);
    }
    await store.save({ baseUrl: "https://8.8.4.4", model: "third", apiKey: "new-test-key" });
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(saved.apiKey, "new-test-key");
    assert.equal(saved.baseUrl, "https://8.8.4.4");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fixed DeepSeek endpoint supports the documented JSON contract under local fake DNS", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-deepseek-contract-"));
  t.mock.method(dns, "lookup", async () => [{ address: "127.0.0.1", family: 4 }]);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body as string);
    assert.equal(body.model, "deepseek-flash");
    assert.equal(body.max_tokens, 2048);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.match(body.messages[0].content, /JSON/);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  try {
    const store = new CustomAiProviderStore(undefined, root, storage);
    await store.save({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      apiKey: "new-test-key",
    });
    assert.deepEqual(await store.generateJson({ prompt: "Return JSON", maxNewTokens: 2048 }), {
      ok: true,
    });
    assert.equal(calls, 1);
    for (const baseUrl of [
      "https://api.deepseek.com/custom",
      "https://api.deepseek.com:444",
      "https://api.deepseek.com.example.com",
    ]) {
      await assert.rejects(
        store.save({ baseUrl, model: "test", apiKey: "other-test-key" }),
        /custom_ai_private_host_not_allowed/,
      );
    }
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
