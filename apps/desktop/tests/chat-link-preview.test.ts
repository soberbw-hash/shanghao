import assert from "node:assert/strict";
import test from "node:test";

import { getChatLinkPreview } from "../src/main/chat-link-preview";

test("chat thumbnails never fetch local or credential-bearing addresses", async () => {
  for (const url of [
    "http://localhost/admin",
    "http://127.0.0.1:8080/",
    "http://192.168.1.1/",
    "http://printer.local/",
    "https://user:secret@example.com/",
    "file:///C:/Users/sober/secret.txt",
  ]) {
    assert.deepEqual(await getChatLinkPreview(url), {});
  }
});
