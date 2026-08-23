import assert from "node:assert/strict";
import test from "node:test";

import type { AiModelId } from "@private-voice/shared";

import { AiRuntimeManager } from "../src/main/ai-runtime-manager";

test("shared AI Runtime preparation is serialized across model completions", async () => {
  const manager = new AiRuntimeManager("C:\\test-runtime", {
    model: () => undefined,
    qwen: () => undefined,
    activeAsr: () => "qwen3-asr-0.6b-force",
  });
  const internal = manager as unknown as {
    prepareModelRuntimeOnce: (id: AiModelId) => Promise<{ ready: boolean; message?: string }>;
  };
  let active = 0;
  let maximumActive = 0;
  const order: string[] = [];
  internal.prepareModelRuntimeOnce = async (id) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push(`start:${id}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(`end:${id}`);
    active -= 1;
    return { ready: true };
  };

  await Promise.all([
    manager.prepareModelRuntime("qwen3-asr-1.7b-force"),
    manager.prepareModelRuntime("qwen3-asr-0.6b-force"),
    manager.prepareModelRuntime("fun-asr-nano-2512"),
  ]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(order, [
    "start:qwen3-asr-1.7b-force",
    "end:qwen3-asr-1.7b-force",
    "start:qwen3-asr-0.6b-force",
    "end:qwen3-asr-0.6b-force",
    "start:fun-asr-nano-2512",
    "end:fun-asr-nano-2512",
  ]);
});
