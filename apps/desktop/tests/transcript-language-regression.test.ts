import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUnreliableTranscript,
  isChinesePreferredTranscriptText,
  isReliableTranscriptText,
} from "../../../packages/shared/src/utils/transcriptQuality";

test("standalone English, game terms and numbers survive language validation", () => {
  for (const text of ["Let's go.", "Rush B", "GG", "4060", "补一下 HP", "我先过去。"])
    assert.equal(hasUnreliableTranscript([{ text, startMs: 0, endMs: 5000 }]), false, text);
});

test("language acceptance does not bypass silence and repetition guards", () => {
  for (const text of ["", "...", "🎮"]) assert.equal(isChinesePreferredTranscriptText(text), false);
  for (const text of ["[silence]", "go ".repeat(40), "\uFFFD"])
    assert.equal(isReliableTranscriptText(text), false);
});
