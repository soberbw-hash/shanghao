import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { findDeepLinkInvite, parseDeepLinkInvite } from "../src/main/deep-link";

test("room invitation deep links keep only a websocket server and known room", () => {
  const invite = parseDeepLinkInvite(
    "shanghao://join?server=wss%3A%2F%2Fvoice.example.com%3A43821%2F&room=side",
  );
  assert.deepEqual(invite, {
    channelId: "side",
    serverUrl: "wss://voice.example.com:43821/",
  });
});

test("temporary room links keep server configuration private and expire", () => {
  const expires = Date.now() + 5 * 60_000;
  assert.deepEqual(parseDeepLinkInvite(`shanghao://join?room=main&expires=${expires}`), {
    channelId: "main",
  });
  assert.equal(
    parseDeepLinkInvite(`shanghao://join?room=main&expires=${Date.now() - 1}`),
    undefined,
  );
});

test("room invitation deep links reject unsafe or unknown destinations", () => {
  assert.equal(parseDeepLinkInvite("https://example.com/?room=main"), undefined);
  assert.equal(
    parseDeepLinkInvite("shanghao://join?server=https%3A%2F%2Fexample.com&room=main"),
    undefined,
  );
  assert.equal(
    parseDeepLinkInvite("shanghao://join?server=ws%3A%2F%2Fuser%3Apass%40host&room=main"),
    undefined,
  );
  assert.equal(parseDeepLinkInvite("shanghao://join?server=ws%3A%2F%2Fhost&room=third"), undefined);
});

test("deep links are found in Windows second-instance command lines", () => {
  const invite = findDeepLinkInvite([
    "C:\\Program Files\\ShangHao\\ShangHao.exe",
    "--background",
    "shanghao://join?server=ws%3A%2F%2F127.0.0.1%3A43821%2F&room=main",
  ]);
  assert.equal(invite?.channelId, "main");
  assert.equal(invite?.serverUrl, "ws://127.0.0.1:43821/");
});

test("development startup repairs a stale Windows protocol registration", async () => {
  const source = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
  assert.match(source, /removeAsDefaultProtocolClient\(SHANGHAO_PROTOCOL\)/);
  assert.match(
    source,
    /setAsDefaultProtocolClient\(SHANGHAO_PROTOCOL, process\.execPath, \[app\.getAppPath\(\)\]\)/,
  );
});
