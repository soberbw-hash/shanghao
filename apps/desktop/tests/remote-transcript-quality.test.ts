import assert from "node:assert/strict";
import test from "node:test";
import { hasUnreliableTranscript } from "@private-voice/shared";
import { parseVibeVoiceOutput } from "../src/main/asr-transcript-parser";

test("standalone punctuation in a cloud response cannot hide the valid conversation", () => {
  const transcript = parseVibeVoiceOutput("你好！\n！\n我们集合。\n！？", "cloud", 0, 60000);
  assert.deepEqual(
    transcript.map((segment) => segment.text),
    ["你好！", "我们集合。"],
  );
  assert.equal(hasUnreliableTranscript(transcript), false);
  assert.equal(transcript.at(-1)?.endMs, 60000);
});

test("cloud output containing only punctuation still produces no usable transcript", () => {
  assert.deepEqual(parseVibeVoiceOutput("！？\n！", "cloud", 0, 60000), []);
});

test("one unsupported sentence cannot erase the Mandarin conversation around it", () => {
  const transcript = parseVibeVoiceOutput(
    "我们在下路集合。\n왜 넌 이냐마。\n等一下，我马上过来！",
    "mixed-cloud",
    300000,
    300000,
  );
  assert.deepEqual(
    transcript.map((segment) => segment.text),
    ["我们在下路集合。", "等一下，我马上过来！"],
  );
  assert.equal(hasUnreliableTranscript(transcript), false);
});

test("unsupported-only output stays rejected after sentence-level filtering", () => {
  assert.deepEqual(parseVibeVoiceOutput("왜 넌 이냐마。\n왜。", "unsupported", 0, 300000), []);
});
