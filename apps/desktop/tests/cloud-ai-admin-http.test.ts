import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CloudAiRuntime } from "../../../packages/signaling/src/cloud-ai-runtime";
import { CloudAiAdminStore } from "../../../packages/signaling/src/cloud-ai-admin-store";
import type { AccountBackend } from "../../../packages/signaling/src/account-service";
import type { CloudAiAdminSnapshot } from "@private-voice/shared";
import { BuiltInAiClient } from "../src/main/built-in-ai-client";

test("actual runtime switches a failed DeepSeek request to explicitly selected GLM", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-fallback-runtime-"));
  const file = path.join(directory, "providers.json");
  const store = await CloudAiAdminStore.open(file, { CLOUD_AI_API_KEY: "glm-fixture" });
  const saved = await store.mutate({
    action: "save",
    revision: 0,
    provider: {
      kind: "text",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      apiKey: "deepseek-fixture",
    },
  });
  await store.mutate({
    action: "activate",
    revision: 1,
    id: saved.providers.find((p) => p.name === "DeepSeek")!.id,
  });
  await store.mutate({ action: "set-fallback", revision: 2, id: "builtin-text" });
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let activeFallback = 0;
  let peakFallback = 0;
  globalThis.fetch = async (input, init) => {
    const model = JSON.parse(String(init?.body)).model as string;
    calls.push(model);
    if (String(input).startsWith("https://api.deepseek.com/"))
      return new Response("", { status: 402 });
    activeFallback++;
    peakFallback = Math.max(peakFallback, activeFallback);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeFallback--;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"answer":"fallback"}' } }] }),
    );
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  });
  const runtime = new CloudAiRuntime(Promise.resolve({} as never), undefined, undefined, file);
  const result = await runtime.textService.execute({
    type: "cloud_ai_request",
    roomId: "room-a",
    peerId: "a",
    requestId: "request-a",
    purpose: "organize",
    responseFormat: "json",
    prompt: "fixture",
  });
  assert.equal(result, '{"answer":"fallback"}');
  assert.deepEqual(calls, ["deepseek-flash", "glm-4-flash-250414"]);
  const request = {
    type: "cloud_ai_request" as const,
    roomId: "room-b",
    peerId: "b",
    requestId: "request-b",
    purpose: "organize" as const,
    responseFormat: "json" as const,
    prompt: "fixture",
  };
  await Promise.all([runtime.textService.execute(request), runtime.textService.execute(request)]);
  assert.equal(peakFallback, 1);
});

test("only administrators can manage providers and saved changes drive real text requests", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-admin-http-"));
  const previousHash = process.env.CLOUD_AI_ADMIN_KEY_SHA256;
  const adminKey = "A".repeat(43);
  process.env.CLOUD_AI_ADMIN_KEY_SHA256 = createHash("sha256").update(adminKey).digest("hex");
  const nativeFetch = globalThis.fetch;
  let usedModel = "";
  globalThis.fetch = async (_input, init) => {
    usedModel = JSON.parse(String(init?.body)).model;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"summary":"test"}' } }] }),
    );
  };
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    if (previousHash === undefined) delete process.env.CLOUD_AI_ADMIN_KEY_SHA256;
    else process.env.CLOUD_AI_ADMIN_KEY_SHA256 = previousHash;
    await rm(directory, { recursive: true, force: true });
  });
  const runtime = new CloudAiRuntime(
    Promise.resolve({} as never),
    undefined,
    undefined,
    path.join(directory, "providers.json"),
  );
  runtime.configureHttp(
    {
      configured: true,
      verifyAccessToken: async (token: string) => {
        if (!["owner", "ordinary"].includes(token)) throw Error("expired");
        return { userId: token === "owner" ? "owner-id" : "ordinary-id" };
      },
    } as AccountBackend,
    () => true,
  );
  const server = createServer(
    (req, res) =>
      void runtime.handleHttp(req, res).then((handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end();
        }
      }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const keyClient = new BuiltInAiClient(
    () => `ws://127.0.0.1:${address.port}`,
    async () => undefined,
    nativeFetch,
  );
  assert.equal(await keyClient.importAdminKey(origin, adminKey), true);
  assert.equal((await keyClient.adminSnapshot())?.revision, 0);
  const headers = {
    authorization: "Bearer owner",
    "x-shanghao-admin-key": adminKey,
    "content-type": "application/json",
  };
  assert.equal(
    (
      await nativeFetch(origin + "/api/ai/admin/providers", {
        headers: { authorization: "Bearer ordinary" },
      })
    ).status,
    403,
  );
  assert.equal((await nativeFetch(origin + "/api/ai/admin/providers")).status, 403);
  assert.equal(
    (
      await nativeFetch(origin + "/api/ai/admin/providers", {
        headers: { authorization: "Bearer owner" },
      })
    ).status,
    403,
  );
  let snapshot = (await (
    await nativeFetch(origin + "/api/ai/admin/providers", { headers })
  ).json()) as CloudAiAdminSnapshot;
  const save = await nativeFetch(origin + "/api/ai/admin/providers", {
    headers,
    method: "POST",
    body: JSON.stringify({
      revision: snapshot.revision,
      action: "save",
      provider: {
        id: "builtin-text",
        kind: "text",
        name: "test",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: "new-model",
        apiKey: "server-only-secret",
      },
    }),
  });
  assert.equal(save.status, 200);
  const raw = await save.text();
  assert.equal(raw.includes("server-only-secret"), false);
  snapshot = JSON.parse(raw);
  const result = await nativeFetch(origin + "/api/ai/text", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: "synthetic" }),
  });
  assert.equal(result.status, 200);
  assert.equal(usedModel, "new-model");
  assert.equal(
    (
      await nativeFetch(origin + "/api/ai/admin/providers", {
        headers,
        method: "POST",
        body: JSON.stringify({
          revision: snapshot.revision,
          action: "disable",
          id: "builtin-text",
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await nativeFetch(origin + "/api/ai/text", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "synthetic" }),
      })
    ).status,
    503,
  );
});
