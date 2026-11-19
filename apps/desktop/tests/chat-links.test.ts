import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  formatCompactUrl,
  getMessageUrlDetails,
  messageLinkCard,
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

test("a single link keeps the caption on its card and trims trailing URL punctuation", () => {
  assert.equal(
    messageLinkCard("攻略在这里：https://example.com/guide?q=1，晚点一起看")?.url,
    "https://example.com/guide?q=1",
  );
  assert.equal(messageLinkCard("javascript:alert(1)"), undefined);
  assert.equal(messageLinkCard("没有链接"), undefined);
  assert.equal(messageLinkCard("https://example.com/ https://example.org/"), undefined);
});

test("pasted Douyin shares show the caption and short link once", () => {
  assert.deepEqual(
    messageLinkCard(
      "1.51 M@W.mD :3pm 12/07 cNw:/ 盘点英雄专属小曲 #英雄联盟 v.douyin.com/Pw0-3U7syPY 复制此链接，打开Dou音搜索，直接观看视频！",
    ),
    { url: "https://v.douyin.com/Pw0-3U7syPY", caption: "盘点英雄专属小曲 #英雄联盟" },
  );
  assert.deepEqual(messageLinkCard(" https://example.com/guide。 "), {
    url: "https://example.com/guide",
    caption: undefined,
  });
});

test("chat link previews normalize the displayed hostname", () => {
  assert.equal(getMessageUrlDetails("https://www.example.com/guide")?.hostname, "example.com");
});

test("Douyin live-room links keep their room path and query instead of becoming the homepage", () => {
  const liveRoomUrl = "https://live.douyin.com/47199585587?from_search=true&is_aweme_tied=1";
  assert.equal(messageLinkCard(liveRoomUrl)?.url, liveRoomUrl);
  assert.equal(getMessageUrlDetails(liveRoomUrl)?.hostname, "live.douyin.com");
  assert.equal(formatCompactUrl(liveRoomUrl), "live.douyin.com/47199585587");
});

test("right-clicking a link preview copies immediately and reports success", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/MessageLinkPreview.tsx"),
    "utf8",
  );
  assert.equal(source.includes("onContextMenu={(event) =>"), true);
  assert.equal(source.includes("onCopy(url)"), true);
  const owner = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx"),
    "utf8",
  );
  assert.equal(owner.includes("window.desktopApi.clipboard.writeText(url)"), true);
  assert.equal(owner.includes('title: "已复制链接"'), true);
  assert.equal(owner.includes("onCopy={copyLink}"), true);
  assert.equal(source.includes("getLinkPreviewIcon"), false);
  assert.equal(source.includes("<Link2 />"), true);
});

test("chat text, images and links can be dragged into the persistent room collection", () => {
  const source =
    readFileSync(
      path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx"),
      "utf8",
    ) +
    readFileSync(
      path.resolve(process.cwd(), "src/renderer/src/components/chat/MessageLinkPreview.tsx"),
      "utf8",
    );
  const shelfSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/room/RoomCollectionShelf.tsx"),
    "utf8",
  );
  assert.equal(source.includes("writeRoomCollectionDragPayload"), true);
  assert.equal(source.includes('kind: "image"'), true);
  assert.equal(source.includes('kind: "link"'), true);
  assert.equal(source.includes('kind: "text"'), true);
  assert.equal(shelfSource.includes("readRoomCollectionDragPayload"), true);
  const collectionSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomCollection.ts"),
    "utf8",
  );
  assert.equal(collectionSource.includes('title: "已放入收藏"'), true);
  assert.equal(shelfSource.includes("松开放入收藏"), true);
});

test("desktop image files can be dropped even when Windows omits the MIME type", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/utils/chatImage.ts"),
    "utf8",
  );
  assert.equal(source.includes("isSupportedChatImageFile"), true);
  assert.equal(source.includes('".png": "image/png"'), true);
  assert.equal(source.includes('".jpg": "image/jpeg"'), true);
});
