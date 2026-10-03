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

test("cloud fallback handles provider failure without exposing credentials or inventing web search", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const service = new CloudAiService({
    apiKey: "primary-test-key",
    fallback: {
      apiKey: "fallback-test-key",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4-flash-250414",
    },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body) });
      return calls.length === 1
        ? new Response("", { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }));
    },
  });
  assert.equal(await service.execute({ ...request, useWebSearch: true }), '{"answer":"ok"}');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://open.bigmodel.cn/api/paas/v4/chat/completions");
  assert.match(calls[1].body, /不带联网能力/);
  assert.doesNotMatch(calls[1].body, /fallback-test-key/);
  assert.equal(JSON.parse(calls[1].body).thinking, undefined);
});

test("cloud fallback never retries cancellation and cools down after rate limiting", async () => {
  let calls = 0;
  const service = new CloudAiService({
    apiKey: "primary-test-key",
    fallback: {
      apiKey: "fallback-test-key",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4-flash-250414",
    },
    fetcher: async () => {
      calls++;
      return new Response("", { status: 429 });
    },
  });
  await assert.rejects(service.execute(request), /cloud_ai_busy/);
  assert.equal(calls, 2);
  await assert.rejects(service.execute(request), /cloud_ai_busy/);
  assert.equal(calls, 3);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(service.execute(request, cancelled.signal));
  assert.equal(calls, 3);
});

test("organization and room questions share the configured text provider", () => {
  for (const legacyProvider of ["cloud", "local", "custom"] as const) {
    assert.equal(
      resolveAiTextProvider("question", legacyProvider),
      legacyProvider === "custom" ? "custom" : "cloud",
    );
    assert.equal(
      resolveAiTextProvider("organize", legacyProvider),
      legacyProvider === "custom" ? "custom" : "cloud",
    );
  }
});

test("fallback preserves the requesting room memory and never bypasses a failed memory read", async () => {
  let calls = 0;
  let fallbackPrompt = "";
  const options = {
    apiKey: "primary-test-key",
    fallback: {
      apiKey: "memory-test-key",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4-flash-250414",
    },
    memoryContext: async (roomId: string) => `memory for ${roomId}`,
    fetcher: async (_input: unknown, init?: RequestInit) => {
      calls++;
      if (calls === 1) return new Response("", { status: 503 });
      fallbackPrompt = JSON.parse(String(init?.body)).messages[1].content;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }),
      );
    },
  };
  await new CloudAiService(options).execute({ ...request, roomId: "side" });
  assert.match(fallbackPrompt, /memory for side/);
  assert.doesNotMatch(fallbackPrompt, /memory for main/);
  const failure = new CloudAiService({
    ...options,
    memoryContext: async () => {
      throw new Error("memory_read_failed");
    },
  });
  await assert.rejects(failure.execute(request), /memory_read_failed/);
  assert.equal(calls, 2);
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

test("recording recap signaling accepts only bounded manually published summaries", () => {
  const message = {
    type: "publish_recording_recap",
    roomId: "main",
    peerId: "peer-a",
    requestId: "request-a",
    reportDate: "2026-08-30",
    recap: {
      recordingId: "recording-a",
      description: "今晚前半场认真打，后半场开始互相甩锅。",
      summary: ["有人连送两波。"],
      highlights: [],
      funnyMoments: [
        {
          title: "甩锅现场",
          description: "三个人都说不是自己的问题。",
          startMs: 1_000,
          endMs: 4_000,
        },
      ],
      participantNicknames: ["Sober"],
      keywords: ["英雄联盟"],
    },
  };
  assert.equal(isSignalEnvelope(message), true);
  assert.equal(isSignalEnvelope({ ...message, reportDate: "昨天" }), false);
  assert.equal(
    isSignalEnvelope({ ...message, recap: { ...message.recap, description: "x".repeat(801) } }),
    false,
  );
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
    model: "deepseek-flash",
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
  assert.equal(body.includes("deepseek-flash"), true);
  assert.equal(result, '{"summary":[]}');
});

test("cloud AI defaults to Flash 4.1 on both routes and preserves explicit model overrides", async () => {
  const previous = process.env.DEEPSEEK_MODEL;
  try {
    for (const [environment, configured, expected] of [
      ["", undefined, "deepseek-flash"],
      ["environment-model", undefined, "environment-model"],
      ["environment-model", "custom-model", "custom-model"],
    ] as const) {
      process.env.DEEPSEEK_MODEL = environment;
      for (const useWebSearch of [false, true]) {
        let sentModel = "";
        const service = new CloudAiService({
          apiKey: "server-only-test-key",
          model: configured,
          fetcher: async (_input, init) => {
            sentModel = JSON.parse(String(init?.body)).model;
            return new Response("busy", { status: 429 });
          },
        });
        await assert.rejects(service.execute({ ...request, purpose: "question", useWebSearch }));
        assert.equal(sentModel, expected);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = previous;
  }
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
