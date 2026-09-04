import type { AiModelId, AiSupportModelId } from "@private-voice/shared";

export interface ModelComponent {
  directory: string;
  repository: string;
  revision: string;
}

export interface ModelDefinition {
  id: AiModelId;
  category: "asr" | "support" | "organizer";
  name: string;
  purpose: string;
  repository: string;
  revision: string;
  approximateBytes: number;
  components?: readonly ModelComponent[];
  dependencies?: readonly AiSupportModelId[];
  optionalDependencies?: readonly AiSupportModelId[];
  requiresHuggingFaceAuthorization?: boolean;
  hardwareNote?: string;
  inferenceBackend?: "builtin" | "freetoken";
  files?: readonly string[];
}

export interface ModelSource {
  name: string;
  baseUrl: string;
}

export const QWEN36_NVFP4_MODEL_REVISION = "1355db6a052410cfd62085d94b58866fd0f2c3c5";

export const QWEN36_NVFP4_MODEL_DEFINITION: ModelDefinition = {
  id: "qwen36-35b-a3b-nvfp4",
  category: "organizer",
  name: "Qwen3.6-35B-A3B",
  purpose: "高质量本地整理｜MoE 35B / 3B Active",
  repository: "nvidia/Qwen3.6-35B-A3B-NVFP4",
  revision: QWEN36_NVFP4_MODEL_REVISION,
  approximateBytes: 23_462_477_857,
  inferenceBackend: "freetoken",
  hardwareNote:
    "FreeToken · NVFP4 · 仅绑定 127.0.0.1；以 RTX 4060 Ti 8GB + 32GB 内存实测为准，不会静默切换模型或量化。",
};

// Mainland mirror first; the immutable official revision remains the fallback.
export const MODEL_SOURCES: readonly ModelSource[] = [
  { name: "Hugging Face 镜像", baseUrl: "https://hf-mirror.com" },
  { name: "Hugging Face", baseUrl: "https://huggingface.co" },
] as const;
