import assert from "node:assert/strict";
import test from "node:test";
import { readChatLinkMetadata } from "../src/main/chat-link-metadata";

test("collection previews read readable titles, descriptions and site identity", () => {
  const metadata = readChatLinkMetadata(`
    <title>Fallback title</title>
    <meta content="游戏 &amp; 搭子 &#x1F3AE;" property="og:title">
    <meta NAME='description' content='简介 &quot;内容&quot; &#20013;文'>
    <meta property="og:site_name" content="示例网站">
    <meta property="og:image" content="/cover.png?a=1&amp;b=2">
  `);
  assert.deepEqual(metadata, {
    title: "游戏 & 搭子 🎮",
    description: '简介 "内容" 中文',
    siteName: "示例网站",
    image: "/cover.png?a=1&amp;b=2",
  });
});

test("metadata handles ordinary pages, missing data and bounded untrusted text", () => {
  assert.equal(readChatLinkMetadata("<title> 普通\n 页面 </title>").title, "普通 页面");
  assert.equal(
    readChatLinkMetadata('<meta name="twitter:title" content="备用标题">').title,
    "备用标题",
  );
  assert.equal(readChatLinkMetadata("").description, undefined);
  assert.equal(
    readChatLinkMetadata(`<meta name="description" content="${"字".repeat(400)}">`).description
      ?.length,
    240,
  );
  assert.equal(
    readChatLinkMetadata('<meta name="description" content="&lt;b&gt;文本&lt;/b&gt; &#99999999;">')
      .description,
    "文本",
  );
});
