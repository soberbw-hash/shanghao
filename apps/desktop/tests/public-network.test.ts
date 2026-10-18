import assert from "node:assert/strict";
import test from "node:test";
import { promises as dns } from "node:dns";
import http from "node:http";
import { PassThrough, Readable } from "node:stream";
import {
  fetchPublicUrl,
  isPublicNetworkAddress,
  resolvePublicAddress,
  readPublicResponse,
} from "../src/main/public-network";
import { getChatLinkPreview } from "../src/main/chat-link-preview";

test("network guards reject alternate private IPv4 and IPv6 representations", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.2",
    "100.100.100.200",
    "198.18.0.1",
    "192.0.2.1",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "2002:7f00:1::",
    "2001:db8::1",
    "ff02::1",
  ])
    assert.equal(isPublicNetworkAddress(address), false, address);
  assert.equal(isPublicNetworkAddress("8.8.8.8"), true);
  assert.equal(isPublicNetworkAddress("2001:4860:4860::8888"), true);
  for (const value of [
    "http://2130706433/",
    "http://0x7f000001/",
    "http://[::ffff:7f00:1]/",
    "http://printer.local/",
    "https://user:secret@example.com/",
  ])
    await assert.rejects(resolvePublicAddress(new URL(value), "blocked"), /blocked/);
});

test("mixed public/private DNS answers fail before opening a connection", async (t) => {
  t.mock.method(dns, "lookup", async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  const request = t.mock.method(http, "request", () => {
    throw Error("must not connect");
  });
  await assert.rejects(fetchPublicUrl("http://mixed.example/"), /address_not_allowed/);
  assert.equal(request.mock.callCount(), 0);
});

test("the socket uses the checked address even if DNS rebinds; preview redirects are rechecked", async (t) => {
  let lookups = 0,
    connections = 0;
  t.mock.method(dns, "lookup", async () => [
    { address: ++lookups === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 },
  ]);
  t.mock.method(
    http,
    "request",
    (_url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
      connections++;
      assert.equal(options.agent, false);
      const lookup = options.lookup!;
      lookup("rebind.example", { all: false }, (error, address) => {
        assert.equal(error, null);
        assert.equal(address, "8.8.8.8");
      });
      const request = new PassThrough();
      const response = Readable.from([Buffer.from("redirect")]) as http.IncomingMessage;
      response.statusCode = 302;
      response.headers = { location: "http://rebound.example/private" };
      queueMicrotask(() => callback(response));
      return request as unknown as http.ClientRequest;
    },
  );
  assert.deepEqual(await getChatLinkPreview("http://rebind.example/test-pinned"), {});
  assert.equal(lookups, 2);
  assert.equal(connections, 1);
});

test("fake-IP compatibility still pins independently resolved public addresses and rejects private answers", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "198.18.1.23", family: 4 }]);
  let answer = "8.8.8.8";
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.origin, "https://dns.alidns.com");
    assert.equal(init.redirect, "error");
    return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: answer }] }));
  });
  assert.equal(
    (await resolvePublicAddress(new URL("https://public.example"), "blocked")).address,
    "8.8.8.8",
  );
  answer = "127.0.0.1";
  await assert.rejects(
    resolvePublicAddress(new URL("https://public.example"), "blocked"),
    /blocked/,
  );
});

test("oversized public responses cancel the stream without loading the full payload", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start: (controller) => controller.enqueue(new Uint8Array(1024)),
      cancel: () => {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readPublicResponse(response, 32), /too_large/);
  assert.equal(cancelled, true);
});

test("cancellation interrupts a stalled DNS lookup without starting a socket", async (t) => {
  t.mock.method(dns, "lookup", () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = fetchPublicUrl("http://stalled.example/", { signal: controller.signal });
  controller.abort(new Error("cancelled DNS"));
  await assert.rejects(pending, /cancelled DNS/);
});
