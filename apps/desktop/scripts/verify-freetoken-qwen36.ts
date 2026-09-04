import { existsSync } from "node:fs";
import path from "node:path";

import { FreeTokenLocalLlmProvider } from "../src/main/freetoken-local-llm-provider";

const REVISION = "1355db6a052410cfd62085d94b58866fd0f2c3c5";
const root =
  process.env.SHANGHAO_AI_MODELS_ROOT ??
  path.join(process.env.APPDATA ?? process.cwd(), "shanghao", "ai-models");
const modelDirectory = path.join(root, "qwen36-35b-a3b-nvfp4", REVISION);

if (!existsSync(path.join(modelDirectory, "model.safetensors.index.json"))) {
  throw new Error(`Qwen3.6 model is incomplete: ${modelDirectory}`);
}

const provider = new FreeTokenLocalLlmProvider(
  () => modelDirectory,
  REVISION,
  async (payload) => {
    process.stdout.write(`${JSON.stringify({ log: payload.message, context: payload.context })}\n`);
  },
);

const unsubscribe = provider.onStatus((status) => {
  process.stdout.write(
    `${JSON.stringify({
      phase: status.metrics.phase,
      ready: status.ready,
      version: status.metrics.version,
      message: status.message,
    })}\n`,
  );
});

const stop = (): void => {
  unsubscribe();
  provider.stop();
};

process.once("SIGINT", () => {
  stop();
  process.exitCode = 130;
});

const main = async (): Promise<void> => {
  try {
    const prepared = await provider.prepare();
    if (!prepared.ready) throw new Error(prepared.message ?? "FreeToken is not ready");
    const runs = [];
    for (const suffix of ["第一次", "第二次"]) {
      const result = await provider.generateJson<{
        summary: string;
        topics: string[];
        highlights: Array<{ startTime: number; endTime: number; text: string }>;
      }>({
        prompt: [
          `这是${suffix}连续整理测试。严格根据原文输出 JSON。`,
          "[00:02-00:08] Sober：今天先试一下本地整理模型。",
          "[00:09-00:14] grampus：行，看看它能不能把时间点留下来。",
          "JSON 字段：summary、topics、highlights；highlights 项包含 startTime、endTime、text。",
        ].join("\n"),
        maxNewTokens: 192,
        timeoutMs: 30 * 60_000,
      });
      runs.push({ suffix, result: result.value, metrics: result.metrics });
    }
    process.stdout.write(`${JSON.stringify({ runs }, null, 2)}\n`);
  } finally {
    stop();
  }
};

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
