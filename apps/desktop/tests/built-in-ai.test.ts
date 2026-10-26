import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CloudAsrHttpController } from "../../../packages/signaling/src/cloud-asr-http-controller";
import { CloudAsrService } from "../../../packages/signaling/src/cloud-asr-service";
import { CloudAiService } from "../../../packages/signaling/src/cloud-ai-service";
import type { AccountBackend } from "../../../packages/signaling/src/account-service";
import { BuiltInAiClient } from "../src/main/built-in-ai-client";

const accounts = {
  configured: true,
  verifyAccessToken: async (token: string) => {
    if (!new Set(["app-account-token"]).has(token)) throw Error("private-secret-error");
    return { userId: "private-user" };
  },
} as unknown as AccountBackend;
const auth = {
  authorization: "Bearer app-account-token",
  "content-type": "audio/wav",
  "x-shanghao-duration-ms": "1000",
};
const textAuth = { authorization: auth.authorization, "content-type": "application/json" };
const audio = Buffer.from("synthetic-audio");
const options = {
  apiKey: "server-text-key",
  baseUrl: "https://example.com",
  model: "glm-4-flash-250414",
  fetcher: async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: '{"summary":"synthetic"}' } }] }),
    ),
};

async function fixture(
  t: TestContext,
  fetcher: typeof fetch = async () => new Response('{"text":"synthetic transcript"}'),
) {
  const requests: { url: string; authorization: string }[] = [];
  const service = new CloudAsrService("server-only-key", async (url, init) => {
    requests.push({
      url: String(url),
      authorization: String(new Headers(init?.headers).get("authorization")),
    });
    return fetcher(url, init);
  });
  const controller = new CloudAsrHttpController(
    accounts,
    () => true,
    service,
    new CloudAiService(options),
  );
  const server = createServer((req, res) => {
    void controller.handle(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

test("server-funded audio authenticates app accounts and never accepts a provider key, URL, model or filename", async (t) => {
  const f = await fixture(t);
  const status = await (await fetch(f.url + "/api/ai/status")).json();
  assert.equal(status.transcriptionConfigured, true);
  assert.equal(status.textConfigured, true);
  assert.equal(JSON.stringify(status).includes("server-only-key"), false);
  assert.equal(
    (
      await fetch(f.url + "/api/ai/transcriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: audio,
      })
    ).status,
    401,
  );
  assert.equal(f.requests.length, 0);
  for (const invalid of [
    { model: "override" },
    { url: "https://other.invalid" },
    { apiKey: "user-key" },
    { filePath: "C:/private.wav" },
  ]) {
    assert.equal(
      (
        await fetch(f.url + "/api/ai/transcriptions", {
          method: "POST",
          headers: textAuth,
          body: JSON.stringify(invalid),
        })
      ).status,
      415,
    );
  }
  for (const duration of ["0", "300001", "NaN", ""]) {
    assert.equal(
      (
        await fetch(f.url + "/api/ai/transcriptions", {
          method: "POST",
          headers: { ...auth, "x-shanghao-duration-ms": duration },
          body: audio,
        })
      ).status,
      400,
    );
  }
  const response = await fetch(f.url + "/api/ai/transcriptions", {
    method: "POST",
    headers: auth,
    body: audio,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "synthetic transcript");
  assert.deepEqual(f.requests, [
    {
      url: "https://api.siliconflow.cn/v1/audio/transcriptions",
      authorization: "Bearer server-only-key",
    },
  ]);
});

test("background text summaries use only supplied recording text, without joining or reading a room", async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.url + "/api/ai/text", {
    method: "POST",
    headers: textAuth,
    body: JSON.stringify({ prompt: "Summarize synthetic recording" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, '{"summary":"synthetic"}');
  assert.equal(
    (
      await fetch(f.url + "/api/ai/text", {
        method: "POST",
        headers: textAuth,
        body: JSON.stringify({ prompt: "x", roomId: "other-room" }),
      })
    ).status,
    400,
  );
});

test("desktop without vendor credentials transcribes through the authenticated server and strips local filenames", async (t) => {
  const f = await fixture(t);
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-built-in-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "private-recording-name.wav");
  await writeFile(file, "synthetic-audio");
  const calls: { body?: string; authorization: string | null }[] = [];
  const client = new BuiltInAiClient(
    () => f.url.replace("http:", "ws:"),
    async () => "app-account-token",
    async (url, init) => {
      calls.push({
        body:
          typeof init?.body === "string"
            ? init.body
            : init?.body instanceof ArrayBuffer
              ? Buffer.from(init.body).toString("utf8")
              : undefined,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return fetch(url, init);
    },
  );
  assert.equal((await client.status()).transcriptionConfigured, true);
  assert.equal((await client.status()).transcriptionConfigured, true);
  assert.equal(calls.length, 1);
  assert.equal(
    (await client.transcribe(file, 1000, new AbortController().signal)).text,
    "synthetic transcript",
  );
  const upload = calls[1]!;
  assert.equal(upload.body, "synthetic-audio");
  assert.equal(upload.authorization, "Bearer app-account-token");
  assert.equal(upload.body?.includes(directory), false);
  assert.equal(upload.body?.includes("private-recording-name"), false);
  assert.equal(upload.body?.includes("server-only-key"), false);
  assert.equal(await client.organize("synthetic text"), '{"summary":"synthetic"}');
  const noLogin = new BuiltInAiClient(
    () => f.url.replace("http:", "ws:"),
    async () => undefined,
  );
  await assert.rejects(noLogin.organize("x"), /account_session_expired/);
});

test("cancelled uploads abort provider work and release the account slot; concurrent work cannot duplicate charges", async (t) => {
  let started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  let cancelled = false;
  const f = await fixture(t, async (_url, init) => {
    started();
    return new Promise((_resolve, reject) =>
      init?.signal?.addEventListener(
        "abort",
        () => {
          cancelled = true;
          reject(Error("cancelled"));
        },
        { once: true },
      ),
    );
  });
  const abort = new AbortController();
  const waiting = fetch(f.url + "/api/ai/transcriptions", {
    method: "POST",
    headers: auth,
    body: audio,
    signal: abort.signal,
  }).catch(() => undefined);
  await start;
  assert.equal(
    (
      await fetch(f.url + "/api/ai/transcriptions", {
        method: "POST",
        headers: auth,
        body: audio,
      })
    ).status,
    429,
  );
  abort.abort();
  await waiting;
  for (let i = 0; i < 20 && !cancelled; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cancelled, true);
});

test("provider failures never return raw upstream bodies or credentials", async (t) => {
  const f = await fixture(t, async () => new Response("private-upstream-key", { status: 401 }));
  const response = await fetch(f.url + "/api/ai/transcriptions", {
    method: "POST",
    headers: auth,
    body: audio,
  });
  assert.deepEqual(await response.json(), { error: { code: "cloud_asr_http_401" } });
});

test("the built-in server defaults to GLM rather than the paid DeepSeek route", async () => {
  const names = [
    "CLOUD_AI_API_KEY",
    "CLOUD_AI_BASE_URL",
    "CLOUD_AI_MODEL",
    "CLOUD_AI_DEFAULT_PROVIDER",
    "CLOUD_AI_FALLBACK_API_KEY",
    "CLOUD_AI_FALLBACK_MODEL",
    "CLOUD_AI_FALLBACK_BASE_URL",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_MODEL",
  ] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.CLOUD_AI_API_KEY;
    delete process.env.CLOUD_AI_BASE_URL;
    delete process.env.CLOUD_AI_MODEL;
    process.env.CLOUD_AI_DEFAULT_PROVIDER = "deepseek";
    process.env.CLOUD_AI_FALLBACK_API_KEY = "synthetic-glm";
    process.env.CLOUD_AI_FALLBACK_MODEL = "glm-4-flash-250414";
    process.env.CLOUD_AI_FALLBACK_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    process.env.DEEPSEEK_API_KEY = "synthetic-unused";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    const calls: { url: string; model: string; key: string | null }[] = [];
    const service = new CloudAiService({
      fetcher: async (url, init) => {
        calls.push({
          url: String(url),
          model: JSON.parse(String(init?.body)).model,
          key: new Headers(init?.headers).get("authorization"),
        });
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
      },
    });
    await service.execute({
      type: "cloud_ai_request",
      requestId: "test",
      roomId: "personal",
      peerId: "test",
      purpose: "organize",
      responseFormat: "json",
      prompt: "synthetic",
    });
    assert.deepEqual(calls, [
      {
        url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        model: "glm-4-flash-250414",
        key: "Bearer synthetic-glm",
      },
    ]);
    // Even a transient GLM failure must never activate stale DeepSeek credentials.
    let failures = 0;
    const failing = new CloudAiService({
      fetcher: async () => {
        failures += 1;
        return new Response("busy", { status: 429 });
      },
    });
    await assert.rejects(
      failing.execute({
        type: "cloud_ai_request",
        requestId: "failed",
        roomId: "personal",
        peerId: "test",
        purpose: "organize",
        responseFormat: "json",
        prompt: "synthetic",
      }),
      /cloud_ai_busy/,
    );
    assert.equal(failures, 1);
    delete process.env.CLOUD_AI_FALLBACK_API_KEY;
    assert.equal(new CloudAiService().isConfigured(), false);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("server-network failures and busy replies stay retryable without losing a saved transcript", async () => {
  const failed = new BuiltInAiClient(
    () => "wss://example.com",
    async () => "synthetic-token",
    async () => {
      throw new TypeError("fetch failed");
    },
  );
  await assert.rejects(failed.organize("synthetic"), /cloud_asr_network_error/);
  const busy = new BuiltInAiClient(
    () => "wss://example.com",
    async () => "synthetic-token",
    async () => new Response('{"error":{"code":"cloud_asr_busy"}}', { status: 429 }),
  );
  await assert.rejects(busy.organize("synthetic"), /cloud_asr_http_429/);
});

test("an undeployed cloud backend is detected before opening or uploading a recording", async () => {
  let posts = 0;
  const client = new BuiltInAiClient(
    () => "wss://example.com",
    async () => "synthetic-token",
    async (_url, init) => {
      if (init?.method === "POST") posts++;
      return new Response("Route has not been deployed", { status: 404 });
    },
  );
  const status = await client.status();
  assert.equal(status.errorCode, "cloud_asr_backend_upgrade_required");
  assert.equal(status.available, false);
  await assert.rejects(
    client.transcribe("file-that-must-not-be-opened.wav", 1000, new AbortController().signal),
    /cloud_asr_backend_upgrade_required/,
  );
  assert.equal(posts, 0);
});

test("plain-text proxy errors preserve actionable HTTP codes rather than JSON parse errors", async () => {
  for (const [status, expected] of [
    [404, "cloud_asr_backend_upgrade_required"],
    [502, "cloud_asr_http_502"],
    [503, "cloud_asr_http_503"],
  ] as const) {
    const client = new BuiltInAiClient(
      () => "wss://example.com",
      async () => "synthetic-token",
      async () => new Response("<html>Private proxy detail</html>", { status }),
    );
    await assert.rejects(
      client.organize("synthetic"),
      (error) => error instanceof Error && error.message === expected,
    );
  }
  for (const raw of ["null", "[]", '{"healthy":true}']) {
    const client = new BuiltInAiClient(
      () => "wss://example.com",
      async () => "synthetic-token",
      async () => new Response(raw),
    );
    assert.equal((await client.status()).transcriptionConfigured, false);
  }
});
