import assert from "node:assert/strict";
import test from "node:test";

import type { AiModelStatus } from "@private-voice/shared";

import {
  modelPhaseLabel,
  modelProgressPercent,
} from "../src/renderer/src/features/ai/modelDownloadPresentation";

const modelStatus = (patch: Partial<AiModelStatus>): AiModelStatus => ({
  id: "fun-asr-nano-2512",
  category: "asr",
  name: "Fun-ASR-Nano-2512",
  purpose: "test",
  repository: "test/model",
  approximateBytes: 1_000,
  phase: "downloading",
  userInstalled: true,
  downloadedBytes: 996,
  totalBytes: 1_000,
  progress: 99.6,
  updateInProgress: false,
  runtimeReady: false,
  ...patch,
});

test("incomplete model bytes never round up to a misleading 100 percent", () => {
  const downloading = modelStatus({});
  assert.equal(modelProgressPercent(downloading), 99);
  assert.equal(modelPhaseLabel(downloading), "下载中 99%");

  const complete = modelStatus({ downloadedBytes: 1_000, progress: 100 });
  assert.equal(modelProgressPercent(complete), 100);
  assert.equal(modelPhaseLabel(complete), "文件下载完成，准备校验…");
});

test("queued, integrity verification and Runtime preparation are distinct model phases", () => {
  assert.equal(modelPhaseLabel(modelStatus({ phase: "queued" })), "等待下载…");
  assert.equal(modelPhaseLabel(modelStatus({ phase: "checking" })), "正在读取文件清单…");
  assert.equal(
    modelPhaseLabel(modelStatus({ phase: "verifying", progress: 100 })),
    "正在校验完整性…",
  );
  assert.equal(
    modelPhaseLabel(modelStatus({ phase: "preparing", progress: 100 })),
    "正在准备 AI Runtime…",
  );
  assert.equal(
    modelPhaseLabel(modelStatus({ phase: "error", failureKind: "access" })),
    "需要 Hugging Face 授权",
  );
});
