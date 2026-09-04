import { access } from "node:fs/promises";
import path from "node:path";

import type { AiModelId } from "@private-voice/shared";

import { ACTIVE_ARK_ASR_VARIANT } from "./ark-asr-config";

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
  "moss-transcribe-diarize-0.9b-q8_0": ["MOSS-Transcribe-Diarize-Q8_0.gguf"],
  "dolphin-cn-dialect-0.4b": ["small.cn.pt", "train.yaml", "units.txt", "global_cmvn"],
  "cohere-transcribe-2b": [
    "config.json",
    "preprocessor_config.json",
    "processor_config.json",
    "tokenizer_config.json",
    "model.safetensors",
  ],
  "ark-asr-3b-q8_0": [ACTIVE_ARK_ASR_VARIANT.fileName],
  "qwen36-35b-a3b-nvfp4": [
    "config.json",
    "model.safetensors.index.json",
    "model-00001-of-00003.safetensors",
    "model-00002-of-00003.safetensors",
    "model-00003-of-00003.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
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
  if (id === "moss-transcribe-diarize-0.9b-q8_0") return ["MOSS-Transcribe-Diarize-Q8_0.gguf"];
  if (id === "dolphin-cn-dialect-0.4b") return ["small.cn.pt"];
  if (id === "cohere-transcribe-2b") return ["model.safetensors"];
  if (id === "ark-asr-3b-q8_0") return [ACTIVE_ARK_ASR_VARIANT.fileName];
  if (id === "qwen36-35b-a3b-nvfp4")
    return manifestFileNames.filter((file) => /^model-\d+-of-\d+\.safetensors$/.test(file));
  return manifestFileNames.filter(
    (file) => file.endsWith(".safetensors") || file.endsWith(".gguf") || file.endsWith("model.pt"),
  );
};
