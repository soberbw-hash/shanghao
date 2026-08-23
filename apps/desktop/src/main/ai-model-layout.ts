import { access } from "node:fs/promises";
import path from "node:path";

import type { AiModelId } from "@private-voice/shared";

const REQUIRED_MODEL_FILES: Readonly<Partial<Record<AiModelId, readonly string[]>>> = {
  "fun-asr-nano-2512": ["model.pt", "config.yaml", "configuration.json", "multilingual.tiktoken"],
  "fireredasr2-aed": [
    "model.pth.tar",
    "config.yaml",
    "cmvn.ark",
    "dict.txt",
    "train_bpe1000.model",
  ],
  "paraformer-zh": [
    "asr/config.yaml",
    "asr/model.pt",
    "vad/config.yaml",
    "vad/model.pt",
    "punc/config.yaml",
    "punc/model.pt",
  ],
  "moss-transcribe-diarize-0.9b": [
    "config.json",
    "preprocessor_config.json",
    "processor_config.json",
    "tokenizer_config.json",
    "model-00000-of-00001.safetensors",
  ],
  "dolphin-cn-dialect-0.4b": ["small.cn.pt", "train.yaml", "units.txt", "global_cmvn"],
  "cohere-transcribe-2b": [
    "config.json",
    "preprocessor_config.json",
    "processor_config.json",
    "tokenizer_config.json",
    "model.safetensors",
  ],
} as const;

export const requiredModelFiles = (id: AiModelId): readonly string[] =>
  REQUIRED_MODEL_FILES[id] ?? ["config.json"];

export const modelFilesPresent = async (id: AiModelId, directory: string): Promise<boolean> => {
  try {
    await Promise.all(requiredModelFiles(id).map((file) => access(path.join(directory, file))));
    return true;
  } catch {
    return false;
  }
};

export const requiredWeightFiles = (
  id: AiModelId,
  manifestFileNames: readonly string[],
): readonly string[] => {
  if (id === "fun-asr-nano-2512") return ["model.pt"];
  if (id === "fireredasr2-aed") return ["model.pth.tar"];
  if (id === "paraformer-zh") return ["asr/model.pt", "vad/model.pt", "punc/model.pt"];
  if (id === "moss-transcribe-diarize-0.9b") return ["model-00000-of-00001.safetensors"];
  if (id === "dolphin-cn-dialect-0.4b") return ["small.cn.pt"];
  if (id === "cohere-transcribe-2b") return ["model.safetensors"];
  return manifestFileNames.filter(
    (file) => file.endsWith(".safetensors") || file.endsWith(".gguf") || file.endsWith("model.pt"),
  );
};
