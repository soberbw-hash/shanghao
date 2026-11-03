import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CloudAiRuntime } from "../../../packages/signaling/src/cloud-ai-runtime";
import type { AccountBackend } from "../../../packages/signaling/src/account-service";
import type { CloudAiAdminSnapshot } from "@private-voice/shared";

test("only administrators can manage providers and saved changes drive real text requests", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-admin-http-"));
  const previousIds = process.env.CLOUD_AI_ADMIN_USER_IDS;
  process.env.CLOUD_AI_ADMIN_USER_IDS = "owner-id";
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
    if (previousIds === undefined) delete process.env.CLOUD_AI_ADMIN_USER_IDS;
    else process.env.CLOUD_AI_ADMIN_USER_IDS = previousIds;
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
  const headers = { authorization: "Bearer owner", "content-type": "application/json" };
  assert.equal(
    (
      await nativeFetch(origin + "/api/ai/admin/providers", {
        headers: { authorization: "Bearer ordinary" },
      })
    ).status,
    403,
  );
  assert.equal((await nativeFetch(origin + "/api/ai/admin/providers")).status, 403);
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
