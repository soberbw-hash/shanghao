import assert from "node:assert/strict";
import test from "node:test";
import { identifyMusicLink } from "../src/renderer/src/features/chat/musicLink";
test("shared music links retain their canonical provider and original track URL", () => {
  for (const [url, platform] of [
    ["https://y.qq.com/n/ryqq/songDetail/001", "QQ 音乐"],
    ["https://music.163.com/#/song?id=123", "网易云音乐"],
    ["https://music.apple.com/cn/album/test/123?i=124", "Apple Music"],
    ["https://m.kugou.com/song/123.html", "酷狗音乐"],
    ["https://open.spotify.com/track/123", "Spotify"],
    ["https://qishui.douyin.com/s/abc", "汽水音乐"],
  ])
    assert.deepEqual(identifyMusicLink(url!), { platform, url: new URL(url!).href });
  for (const url of [
    "https://y.qq.com.evil.test/track",
    "https://evilqq.com/",
    "file:///music.apple.com/song",
    "https://music.apple.com@127.0.0.1/",
    "https://y.qq.com:8443/",
  ])
    assert.equal(identifyMusicLink(url), undefined);
});
