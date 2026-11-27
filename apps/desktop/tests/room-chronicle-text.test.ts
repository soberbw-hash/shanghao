import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanChronicleSpeech,
  readChronicleStories,
} from "../../../packages/signaling/src/room-chronicle-text";

test("metadata and pure hesitation are skipped, short answers and game words survive", () => {
  assert.equal(cleanChronicleSpeech("🎼 <|BGM|> <|Speech|> 嗯，呃。"), "");
  assert.equal(cleanChronicleSpeech("<|zh|> 先拿小龙 🎼 😊"), "先拿小龙");
  assert.equal(cleanChronicleSpeech("可以。"), "可以。");
  assert.equal(cleanChronicleSpeech("对，开团！"), "对，开团！");
  assert.equal(cleanChronicleSpeech("I'm coming"), "I'm coming");
});

test("a short grounded story survives while unsupported quotes, invalid anchors and walls of text are discarded", () => {
  const evidence = [
    { at: 1000, text: "周六再开黑吧" },
    { at: 25000, text: "先做视野。" },
  ];
  const read = (stories: unknown[]) => readChronicleStories(JSON.stringify({ stories }), evidence);
  assert.deepEqual(
    read([
      { text: "乙说“先做视野”。", sourceIds: [2] },
      { text: "甲说“先做视野”。", sourceIds: [1] },
      { text: "丢弃不存在的编号。", sourceIds: [2, 99] },
    ]),
    [{ at: 25000, text: "乙说“先做视野”。" }],
  );
  assert.deepEqual(
    read([
      { text: "没有依据", sourceIds: [] },
      { text: "字".repeat(141), sourceIds: [1] },
      { text: "甲提议周六再开黑。", sourceIds: [1] },
    ]),
    [{ at: 1000, text: "甲提议周六再开黑。" }],
  );
  assert.deepEqual(readChronicleStories('{"text":"甲提议周六再开黑。"}', evidence), [
    { at: 1000, text: "甲提议周六再开黑。" },
  ]);
  assert.throws(
    () => readChronicleStories('{"unexpected":true}', evidence),
    /chronicle_invalid_summary/,
  );
});
