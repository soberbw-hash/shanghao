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
