import test from "node:test";
import assert from "node:assert/strict";

import { findAsrGameLexicon, normalizeAsrGameLexicon } from "@private-voice/shared";

test("personal game lexicon normalizes names, filters unsafe entries, and caps terms", () => {
  const terms = Array.from({ length: 18 }, (_, index) => `词${index}`);
  const result = normalizeAsrGameLexicon([
    { gameName: "  ＡＰＥＸ  ", terms: [...terms, "外挂<script>"] },
    { gameName: "apex", terms: ["duplicate"] },
    { gameName: "", terms: ["ignored"] },
    { gameName: "有效游戏", terms: ["有效词", "<script>", "有效词"] },
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0]?.gameName, "ＡＰＥＸ");
  assert.equal(result[0]?.terms.length, 16);
  assert.deepEqual(result[1]?.terms, ["有效词"]);
});

test("game lookup is exact and ignores case and compatibility width", () => {
  const entries = normalizeAsrGameLexicon([
    { gameName: "Apex Legends", terms: ["Wraith"] },
    { gameName: "APEX", terms: ["different"] },
  ]);

  assert.equal(findAsrGameLexicon(entries, "ａｐｅｘ legends")?.terms[0], "Wraith");
  assert.equal(findAsrGameLexicon(entries, "Apex")?.terms[0], "different");
  assert.equal(findAsrGameLexicon(entries, "Apex Legends Mobile"), undefined);
});
