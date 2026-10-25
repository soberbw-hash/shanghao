import assert from "node:assert/strict";
import test from "node:test";
import {
  AiModelConfigurationUsage,
  aiModelConfigurationUsage,
} from "../src/main/ai-model-configuration-usage";
import { AiTextGateway } from "../src/main/ai-text-gateway";

test("model configuration remains locked until every concurrent operation settles", async () => {
  const usage = new AiModelConfigurationUsage();
  const states: boolean[] = [];
  const unsubscribe = usage.onChange(() => states.push(usage.busy));
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  const first = usage.run(() => new Promise<void>((resolve) => (finishFirst = resolve)));
  const second = usage.run(() => new Promise<void>((resolve) => (finishSecond = resolve)));
  assert.equal(usage.busy, true);
  assert.throws(() => usage.assertIdle(), /ai_model_configuration_in_use/u);
  await usage.changeSettings({ isAiAutoTranscribeEnabled: false }, async () => undefined);
  for (const patch of [
    { aiAsrModel: "paraformer-zh" as const },
    { aiTranscriptionProvider: "local" as const },
    { isAiCloudLocalAssistEnabled: false },
    { aiCloudLocalAsrModel: "qwen3-asr-1.7b-force" as const },
    { aiOrganizerProvider: "custom" as const },
    { aiRoomAskProvider: "cloud" as const },
    { aiTextModelPreset: "glm" as const },
  ])
    await assert.rejects(
      usage.changeSettings(patch, async () => undefined),
      /ai_model_configuration_in_use/u,
    );
  finishFirst();
  await first;
  assert.equal(usage.busy, true);
  finishSecond();
  await second;
  usage.assertIdle();
  assert.deepEqual(states, [true, false]);
  unsubscribe();
});

test("cloud and custom text requests lock configuration until their response settles", async () => {
  for (const provider of ["cloud", "custom"] as const) {
    let complete!: () => void;
    const response = new Promise<void>((resolve) => (complete = resolve));
    const gateway = new AiTextGateway(
      { getSnapshot: () => ({ aiOrganizerProvider: provider }) } as never,
      {} as never,
      {} as never,
      {
        getJoinedRoomId: () => "main",
        requestCloudAi: async () => {
          await response;
          return '{"text":"ok"}';
        },
      } as never,
      {
        generateJson: async () => {
          await response;
          return { text: "ok" };
        },
      } as never,
      {} as never,
    );
    const operation = gateway.generateJson({
      purpose: "question",
      manual: true,
      prompt: "fixture",
      maxNewTokens: 10,
    });
    try {
      assert.equal(aiModelConfigurationUsage.busy, true);
    } finally {
      complete();
      await operation;
    }
    assert.equal(aiModelConfigurationUsage.busy, false);
  }
});

test("failure and asynchronous cancellation release the lock only after cleanup completes", async () => {
  const usage = new AiModelConfigurationUsage();
  let finishCleanup!: () => void;
  const controller = new AbortController();
  const operation = usage.run(async () => {
    try {
      await new Promise<void>((_resolve, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("cancelled"))),
      );
    } finally {
      await new Promise<void>((resolve) => (finishCleanup = resolve));
    }
  });
  controller.abort();
  await Promise.resolve();
  assert.equal(usage.busy, true);
  finishCleanup();
  await assert.rejects(operation, /cancelled/u);
  assert.equal(usage.busy, false);
  await assert.rejects(
    usage.run(() => {
      throw new Error("synchronous failure");
    }),
  );
  assert.equal(usage.busy, false);
});

test("an admitted configuration write finishes before a newly arriving AI request", async () => {
  const usage = new AiModelConfigurationUsage();
  const order: string[] = [];
  let finishSave!: () => void;
  const save = usage.change(async () => {
    await new Promise<void>((resolve) => (finishSave = resolve));
    order.push("saved");
  });
  const task = usage.run(async () => {
    order.push("started");
  });
  await Promise.resolve();
  assert.deepEqual(order, []);
  assert.equal(usage.busy, true);
  finishSave();
  await Promise.all([save, task]);
  assert.deepEqual(order, ["saved", "started"]);
  assert.equal(usage.busy, false);
});
