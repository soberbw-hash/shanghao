import type { AiModelId } from "@private-voice/shared";
import type { HostResourceCapacity } from "./host-resource-capacity";

// BF16 tensor payload bytes in the pinned official safetensors files, excluding headers.
// The runner swaps the aligner in after recognition. These bounds exclude activations and CUDA.
const weightBytes: Partial<Record<AiModelId, number>> = {
  "qwen3-asr-0.6b-force": 1_876_017_152,
  "qwen3-asr-1.7b-force": 4_698_434_816,
  "qwen3-forced-aligner-0.6b": 1_835_457_792,
};
export function asrHardwareFit(id: AiModelId, capacity: HostResourceCapacity) {
  const floor = weightBytes[id];
  if (!floor) return;
  const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);
  const free = capacity.gpuFreeBytes;
  const blocked = free !== undefined && free < floor;
  const gpu =
    free === undefined
      ? "未读取到显存"
      : `显存可用 ${gib(free)}${capacity.gpuTotalBytes ? ` / ${gib(capacity.gpuTotalBytes)}` : ""} GiB`;
  return {
    blocked,
    message: `${gpu}，系统内存可用 ${gib(capacity.availableMemoryBytes)} GiB。模型权重 ${gib(floor)} GiB，运行峰值待实测。${blocked ? "当前显存不足以冷启动，可选择云端或关闭占用显存的程序。" : ""}`,
  };
}
