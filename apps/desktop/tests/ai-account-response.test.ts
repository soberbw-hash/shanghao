import assert from "node:assert/strict";
import test from "node:test";
import { fetchAiAccountResponse } from "../src/main/ai-account-response";
import { BuiltInAiClient } from "../src/main/built-in-ai-client";

const expired = () =>
  Response.json({ error: { code: "account_session_expired" } }, { status: 401 });
test("only a confirmed login rejection refreshes once, never successful, busy or provider-key responses", async () => {
  for (const status of [200, 403, 429, 500]) {
    let refreshed = 0;
    const response = await fetchAiAccountResponse(
      async () => Response.json({ text: "saved" }, { status }),
      "old",
      async () => {
        refreshed++;
        return "new";
      },
    );
    assert.equal(response.status, status);
    assert.equal(refreshed, 0);
  }
  const sent: string[] = [];
  const result = await fetchAiAccountResponse(
    async (token) => {
      sent.push(token);
      return token === "old" ? expired() : Response.json({ text: "result" });
    },
    "old",
    async () => "new",
  );
  assert.equal(result.status, 200);
  assert.deepEqual(sent, ["old", "new"]);
  let count = 0;
  await fetchAiAccountResponse(
    async () => {
      count++;
      return expired();
    },
    "old",
    async () => "new",
  );
  assert.equal(count, 2);
  await fetchAiAccountResponse(
    async () => Response.json({ error: { code: "cloud_asr_http_401" } }, { status: 401 }),
    "old",
    async () => assert.fail("vendor credentials are not app sessions"),
  );
});

test("unchanged credentials and cancellation cannot trigger another upload", async () => {
  let sent = 0;
  await fetchAiAccountResponse(
    async () => {
      sent++;
      return expired();
    },
    "same",
    async () => "same",
  );
  assert.equal(sent, 1);
  const controller = new AbortController();
  await assert.rejects(
    fetchAiAccountResponse(
      async () => expired(),
      "old",
      async () => {
        controller.abort();
        return "new";
      },
      controller.signal,
    ),
  );
});

test("an oversized streamed auth response fails boundedly without a cloned-stream cancellation hang", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(5000));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 401 },
  );
  await assert.rejects(
    fetchAiAccountResponse(
      async () => response,
      "old",
      async () => assert.fail("oversized auth response cannot refresh"),
    ),
    /cloud_asr_invalid_response/,
  );
  assert.equal(cancelled, true);
});

test("production client retries with refreshed login but refuses crossing an account or server change", async () => {
  for (const changed of ["none", "account", "server"] as const) {
    let owner = "first",
      origin = "wss://example.com",
      uploads = 0,
      refreshes = 0;
    const client = new BuiltInAiClient(
      () => origin,
      async (force) => {
        if (force) {
          refreshes++;
          if (changed === "account") owner = "second";
          if (changed === "server") origin = "wss://another.example";
        }
        return force ? "new-token" : "old-token";
      },
      async (_url, init) => {
        uploads++;
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          uploads === 1 ? "Bearer old-token" : "Bearer new-token",
        );
        return uploads === 1 ? expired() : Response.json({ content: '{"summary":"合成内容"}' });
      },
      () => owner,
    );
    if (changed === "none") assert.match(await client.organize("synthetic prompt"), /summary/);
    else await assert.rejects(client.organize("synthetic prompt"), /account_session_expired/);
    assert.equal(refreshes, 1);
    assert.equal(uploads, changed === "none" ? 2 : 1);
  }
});
