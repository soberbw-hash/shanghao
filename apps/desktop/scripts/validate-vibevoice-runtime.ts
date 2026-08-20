import path from "node:path";

import { AiRuntimeManager } from "../src/main/ai-runtime-manager";

const [recordingPath, runtimeRoot, modelRoot] = process.argv.slice(2);
if (!recordingPath || !runtimeRoot || !modelRoot) {
  throw new Error(
    "usage: validate-vibevoice-runtime <recording> <runtime-root> <vibevoice-model-root>",
  );
}

const main = async (): Promise<void> => {
  const runtime = new AiRuntimeManager(path.resolve(runtimeRoot), {
    vibevoice: () => path.resolve(modelRoot),
    qwen: () => undefined,
  });
  try {
    const status = await runtime.status();
    if (!status.vibevoice.ready) throw new Error(status.vibevoice.message ?? "runtime_not_ready");
    const segments = await runtime.transcribeChunk({
      recordingId: path.resolve(recordingPath),
      filePath: path.resolve(recordingPath),
      offsetMs: 0,
      durationMs: 30_000,
      resourceMode: "low",
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: segments.length > 0,
          outputSource: status.vibevoice.outputSource,
          segments,
        },
        null,
        2,
      )}\n`,
    );
    if (!segments.length) process.exitCode = 2;
  } finally {
    runtime.stop();
  }
};

void main();
