/* eslint-disable no-console */

import { AiModelManager } from "../src/main/ai-model-manager";

const modelId = "qwen36-35b-a3b-nvfp4" as const;
const root = String(process.env.SHANGHAO_AI_MODELS_ROOT ?? "").trim();
if (!root) throw new Error("SHANGHAO_AI_MODELS_ROOT is required");

const gameDetection = {
  getSnapshot: () => ({ checkedAt: new Date().toISOString() }),
  onDetected: () => () => undefined,
};
const manager = new AiModelManager(root, gameDetection as never, async (payload) =>
  console.log(JSON.stringify({ log: payload.message, context: payload.context })),
);
let previous = "";
manager.onStatus((snapshot) => {
  const model = snapshot.models.find((item) => item.id === modelId);
  if (!model) return;
  const current = `${model.phase}:${Math.floor(model.progress)}`;
  if (current === previous) return;
  previous = current;
  console.log(
    JSON.stringify({
      phase: model.phase,
      progress: model.progress,
      downloadedBytes: model.downloadedBytes,
      totalBytes: model.totalBytes,
      bytesPerSecond: model.bytesPerSecond,
      error: model.errorMessage,
    }),
  );
});

const main = async () => {
  try {
    await manager.initialize("manual");
    const initial = manager.getSnapshot().models.find((item) => item.id === modelId);
    if (initial?.phase === "not_installed" || initial?.phase === "error") {
      await manager.controlModel(modelId, "download");
    } else if (initial?.phase === "paused") {
      await manager.controlModel(modelId, "resume");
    }
    for (;;) {
      const model = manager.getSnapshot().models.find((item) => item.id === modelId);
      if (model?.phase === "installed" || model?.phase === "error") {
        console.log(JSON.stringify({ terminal: model }));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  } finally {
    manager.stop();
  }
};

void main();
