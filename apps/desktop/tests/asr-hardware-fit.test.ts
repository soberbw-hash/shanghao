import test from "node:test";
import assert from "node:assert/strict";
import { asrHardwareFit } from "../src/main/asr-hardware-fit";
test("cold-start checks use verified weight bytes, available VRAM and unknown telemetry", () => {
  const device = {
    availableMemoryBytes: 16 * 1024 ** 3,
    gpuTotalBytes: 8 * 1024 ** 3,
    gpuFreeBytes: 3 * 1024 ** 3,
    sampledAt: 1,
  };
  assert.equal(asrHardwareFit("qwen3-asr-0.6b-force", device)?.blocked, false);
  assert.equal(asrHardwareFit("qwen3-asr-1.7b-force", device)?.blocked, true);
  assert.equal(
    asrHardwareFit("qwen3-asr-1.7b-force", { ...device, gpuFreeBytes: undefined })?.blocked,
    false,
  );
  assert.equal(asrHardwareFit("paraformer-zh", device), undefined);
});
