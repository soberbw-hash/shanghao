import assert from "node:assert/strict";
import test from "node:test";
import { answerGlobalVoiceQuestion } from "../src/main/voice-memory-global-question";

test("capability help describes actual app features without inventing system operations or a provider call", async () => {
  const run = async <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    operation(new AbortController().signal);
  for (const question of ["你会做什么", "你能做什么？", "你有什么功能？"]) {
    const result = await answerGlobalVoiceQuestion(
      { question },
      {
        questionRoomId: () => undefined,
        generateJson: async () => {
          throw Error("must not ask a model to guess app capabilities");
        },
      },
      { related: () => [] },
      run,
    );
    assert.match(result.text, /游戏问题/);
    assert.match(result.text, /语音记录/);
    assert.doesNotMatch(result.text, /执行指令|维护系统|无法确认|内部规则/);
    assert.deepEqual(result.sources, []);
  }
});
