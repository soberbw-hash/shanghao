import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  findFirstMessageUrl,
  formatCompactUrl,
  getMessageUrlDetails,
  isMessageOnlyUrl,
} from "../src/renderer/src/features/chat/linkPreview";

test("chat links use a compact visible label without exposing query details", () => {
  assert.equal(
    formatCompactUrl("https://www.example.com/games/guide/?token=private#section"),
    "example.com/games/guide",
  );
  assert.equal(
    formatCompactUrl("https://example.com/a-really-long-path-that-keeps-going-and-going"),
    "example.com/a-really-long-path-that-kee…",
  );
});

test("chat link previews select the first safe web link and trim punctuation", () => {
  assert.equal(
    findFirstMessageUrl("攻略在这里：https://example.com/guide?q=1，晚点一起看"),
    "https://example.com/guide?q=1",
  );
  assert.equal(findFirstMessageUrl("javascript:alert(1)"), undefined);
  assert.equal(findFirstMessageUrl("没有链接"), undefined);
});

test("a message containing only one URL uses the preview card without a duplicate bubble", () => {
  assert.equal(isMessageOnlyUrl("https://chat.deepseek.com/"), true);
  assert.equal(isMessageOnlyUrl(" https://example.com/guide。 "), true);
  assert.equal(isMessageOnlyUrl("攻略：https://example.com/guide"), false);
});

test("chat link previews normalize the displayed hostname", () => {
  assert.equal(getMessageUrlDetails("https://www.example.com/guide")?.hostname, "example.com");
});

test("right-clicking a link preview copies immediately and reports success", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx"),
    "utf8",
  );
  assert.equal(source.includes("onContextMenu={(event) =>"), true);
  assert.equal(source.includes("window.desktopApi.clipboard.writeText(url)"), true);
  assert.equal(source.includes('title: "已复制链接"'), true);
  assert.equal(source.includes("window.desktopApi?.app?.getLinkPreviewIcon"), true);
});
