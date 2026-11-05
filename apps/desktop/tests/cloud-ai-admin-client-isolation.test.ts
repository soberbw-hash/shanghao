import assert from "node:assert/strict";
import test from "node:test";
import { BuiltInAiClient } from "../src/main/built-in-ai-client";

test("admin secrets are not sent when account or relay changes during token acquisition", async () => {
  for (const boundary of ["account", "relay"]) {
    let owner = "admin-one",
      relay = "wss://relay-one.example",
      requests = 0;
    let release!: (token: string) => void;
    const client = new BuiltInAiClient(
      () => relay,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      async () => {
        requests++;
        return new Response('{"revision":0,"providers":[]}');
      },
      () => owner,
    );
    const pending = client.adminChange({
      action: "save",
      revision: 0,
      provider: {
        kind: "text",
        name: "synthetic",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: "synthetic",
        apiKey: "test-only-secret",
      },
    });
    if (boundary === "account") owner = "admin-two";
    else relay = "wss://relay-two.example";
    release("synthetic-account-token");
    await assert.rejects(pending, /account_session_expired/);
    assert.equal(
      requests,
      0,
      `${boundary} changed: no credentials or mutation may leave this process`,
    );
  }
});

test("admin snapshot cannot enter a new account or relay after a slow response body", async () => {
  for (const boundary of ["account", "relay"]) {
    let owner = "admin-one",
      relay = "wss://relay-one.example";
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const client = new BuiltInAiClient(
      () => relay,
      async () => "synthetic-account-token",
      async () => new Response(body),
      () => owner,
    );
    const pending = client.adminSnapshot();
    for (let i = 0; i < 20 && !body.locked; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(body.locked, true, "response headers passed; body is still pending");
    if (boundary === "account") owner = "admin-two";
    else relay = "wss://relay-two.example";
    controller.enqueue(new TextEncoder().encode('{"revision":1,"providers":[]}'));
    controller.close();
    await assert.rejects(pending, /account_session_expired/);
  }
});

test("admin key is bound to its server and does not require a signed-in account", async () => {
  let relay = "wss://relay-one.example";
  let requests = 0;
  const key = "A".repeat(43);
  const client = new BuiltInAiClient(
    () => relay,
    async () => undefined,
    async (_url, init) => {
      requests++;
      assert.equal((init?.headers as Record<string, string>)["x-shanghao-admin-key"], key);
      return new Response('{"revision":0,"providers":[]}');
    },
  );
  await assert.rejects(
    client.importAdminKey("https://other.example", key),
    /cloud_ai_admin_key_invalid/,
  );
  assert.equal(requests, 0);
  assert.equal(await client.importAdminKey("https://relay-one.example", key), true);
  assert.equal((await client.adminSnapshot())?.revision, 0);
  relay = "wss://relay-two.example";
  await assert.rejects(client.adminSnapshot(), /cloud_ai_admin_key_invalid/);
  assert.equal(requests, 2);
});

test("a delayed key-authorized response cannot enter a changed relay", async () => {
  let relay = "wss://relay-one.example",
    calls = 0;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let delayed!: ReadableStream<Uint8Array>;
  const client = new BuiltInAiClient(
    () => relay,
    async () => undefined,
    async () => {
      calls++;
      if (calls === 1) return new Response('{"revision":0,"providers":[]}');
      delayed = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      });
      return new Response(delayed);
    },
  );
  await client.importAdminKey("https://relay-one.example", "A".repeat(43));
  const pending = client.adminSnapshot();
  while (!delayed?.locked) await new Promise<void>((resolve) => setImmediate(resolve));
  relay = "wss://relay-two.example";
  controller.enqueue(new TextEncoder().encode('{"revision":1,"providers":[]}'));
  controller.close();
  await assert.rejects(pending, /cloud_ai_admin_key_invalid/);
});
