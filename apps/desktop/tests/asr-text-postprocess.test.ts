import assert from "node:assert/strict";
import test from "node:test";
import { AI_ASR_MODEL_GROUPS, AI_ASR_MODEL_NAMES } from "@private-voice/shared";
import {
  cleanAsrText,
  hasAsrBody,
  hasValidAsrAlignment,
  restoreAlignedPunctuation,
} from "../src/main/asr-text-postprocess";

test("model presentation groups retain each supported model exactly once", () => {
  const ids = AI_ASR_MODEL_GROUPS.flatMap((group) => group.ids);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), Object.keys(AI_ASR_MODEL_NAMES).sort());
});

test("alignment preserves short real intervals and rejects invalid boundaries", () => {
  assert.equal(
    hasValidAsrAlignment([{ startMs: 10, endMs: 15, words: [{ startMs: 10, endMs: 15 }] }], 100),
    true,
  );
  assert.equal(hasValidAsrAlignment([{ startMs: 10, endMs: 10 }], 100), false);
  assert.equal(
    hasValidAsrAlignment(
      [
        { startMs: 10, endMs: 15 },
        { startMs: 20, endMs: 101 },
      ],
      100,
    ),
    false,
  );
  assert.equal(
    hasValidAsrAlignment([{ startMs: 10, endMs: 15, words: [{ startMs: 10, endMs: NaN }] }], 100),
    false,
  );
});

test("Qwen original punctuation survives exact alignment without timestamp changes", () => {
  const raw = "三彩菊，咱们家为什么有个人？";
  const aligned = [...raw.replace(/[，？]/gu, "")].map((text, index) => ({
    text,
    startMs: index * 100,
    endMs: index * 100 + 100,
  }));
  const before = structuredClone(aligned);
  const restored = restoreAlignedPunctuation(raw, aligned);
  assert.equal(restored.map((part) => part.text).join(""), raw);
  assert.deepEqual(
    restored.map(({ startMs, endMs }) => ({ startMs, endMs })),
    before.map(({ startMs, endMs }) => ({ startMs, endMs })),
  );
  assert.deepEqual(aligned, before);
  assert.deepEqual(restoreAlignedPunctuation("内容不同，不猜。", aligned), aligned);
});

test("explicit provider tokens never become speech; original evidence stays unchanged", () => {
  for (const [provider, raw] of [
    ["fireredasr2-aed", "<sil>"],
    ["dolphin-cn-dialect-0.4b", "<zh><CN><asr><notimestamp>▁"],
  ]) {
    const output = { text: raw };
    assert.equal(cleanAsrText(provider, output.text), "");
    assert.equal(hasAsrBody(cleanAsrText(provider, output.text)), false);
    assert.equal(output.text, raw);
  }
  assert.equal(cleanAsrText("fireredasr2-aed", "<sil>你好，▁team！"), "你好， team！");
  assert.equal(
    cleanAsrText("fireredasr2-aed", "使用<xxx>，比较 a < b。"),
    "使用<xxx>，比较 a < b。",
  );
  assert.equal(cleanAsrText("glm-asr-nano-2512", "原话<sil>"), "原话<sil>");
  for (const text of ["", " ", "。！", "▁"]) assert.equal(hasAsrBody(text), false);
  for (const text of ["嗯", "啊", "对", "往左", "A", "42"]) assert.equal(hasAsrBody(text), true);
});
