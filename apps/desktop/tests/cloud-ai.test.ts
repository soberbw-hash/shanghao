import assert from "node:assert/strict";
import test from "node:test";

import { resolveAiTextProvider } from "../src/main/ai-text-gateway";
import { CloudAiRequestController } from "../../../packages/signaling/src/cloud-ai-request-controller";
import { CloudAiService } from "../../../packages/signaling/src/cloud-ai-service";
import { isSignalEnvelope } from "../../../packages/signaling/src/protocol";

const request = {
  type: "cloud_ai_request" as const,
  roomId: "main",
  peerId: "peer-1",
  requestId: "request-1",
  purpose: "organize" as const,
  responseFormat: "json" as const,
  prompt: "请返回 JSON",
};

test("room questions always use cloud AI without a local model dependency", () => {
  for (const legacyProvider of ["cloud", "local", "custom"] as const) {
    assert.equal(resolveAiTextProvider("question", legacyProvider), "cloud");
    assert.equal(resolveAiTextProvider("organize", legacyProvider), legacyProvider);
  }
});

test("cloud AI signaling accepts bounded joined-room requests only", () => {
  assert.equal(isSignalEnvelope(request), true);
  assert.equal(
    isSignalEnvelope({
      type: "cloud_ai_cancel",
      roomId: "main",
      peerId: "peer-1",
      requestId: "request-1",
    }),
    true,
  );
  assert.equal(
    isSignalEnvelope({
      type: "cloud_ai_cancel",
      roomId: "main",
      peerId: "peer-1",
      requestId: "",
    }),
    false,
  );
  assert.equal(isSignalEnvelope({ ...request, prompt: "" }), false);
  assert.equal(isSignalEnvelope({ ...request, purpose: "tts" }), false);
  assert.equal(isSignalEnvelope({ ...request, prompt: "x".repeat(48_001) }), false);
});

test("server cloud AI forwards cancellation to the provider request", async () => {
  const controller = new AbortController();
  let providerSignal: AbortSignal | undefined;
  const service = new CloudAiService({
    apiKey: "server-only-test-key",
    fetcher: async (_input, init) => {
      providerSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        providerSignal?.addEventListener(
          "abort",
          () => reject(providerSignal?.reason ?? new Error("aborted")),
          { once: true },
        );
      });
    },
  });

  const pending = service.execute(request, controller.signal);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(providerSignal?.aborted, true);
});

test("relay cancellation releases the active cloud question instead of waiting for timeout", async () => {
  let activeSignal: AbortSignal | undefined;
  const responses: Array<{ ok: boolean; errorCode?: string }> = [];
  const socket = {} as never;
  const controller = new CloudAiRequestController(undefined, {
    isConfigured: () => true,
    execute: async (_request, signal) => {
      activeSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  });

  const handling = controller.handle(socket, request, (response) => responses.push(response));
  await Promise.resolve();
  assert.equal(
    controller.cancel(socket, {
      type: "cloud_ai_cancel",
      roomId: request.roomId,
      peerId: request.peerId,
      requestId: request.requestId,
    }),
    true,
  );
  await handling;

  assert.equal(activeSignal?.aborted, true);
  assert.equal(responses.length, 1);
  assert.equal(responses[0]?.ok, false);
  assert.equal(responses[0]?.errorCode, "cloud_ai_cancelled");
});

test("server cloud AI keeps the API key in the authorization header", async () => {
  let url = "";
  let authorization = "";
  let body = "";
  const service = new CloudAiService({
    apiKey: "server-only-test-key",
    model: "deepseek-v4-flash",
    fetcher: async (input, init) => {
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      body = String(init?.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"summary":[]}' } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const result = await service.execute(request);

  assert.equal(url, "https://api.deepseek.com/chat/completions");
  assert.equal(url.includes("server-only-test-key"), false);
  assert.equal(authorization, "Bearer server-only-test-key");
  assert.equal(body.includes("server-only-test-key"), false);
  assert.equal(body.includes("deepseek-v4-flash"), true);
  assert.equal(result, '{"summary":[]}');
});

test("room cloud questions request server-side web search without exposing provider errors", async () => {
  let body = "";
  const service = new CloudAiService({
    apiKey: "server-only-test-key",
    fetcher: async (_input, init) => {
      body = String(init?.body);
      return new Response("upstream details must stay private", { status: 429 });
    },
  });

  await assert.rejects(
    service.execute({ ...request, purpose: "question", useWebSearch: true }),
    (error: Error) => error.message === "cloud_ai_busy",
  );
  assert.equal(body.includes("web_search_20250305"), true);
});
