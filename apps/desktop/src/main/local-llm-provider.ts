import type {
  AiLocalLlmRuntimeMetrics,
  VoiceMemoryOrganizationMetrics,
} from "@private-voice/shared";

export interface LocalLlmGenerateRequest {
  prompt: string;
  maxNewTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface LocalLlmGenerateResult<T> {
  value: T;
  metrics: Omit<
    VoiceMemoryOrganizationMetrics,
    "chunkCount" | "interrupted" | "errors" | "retryCount"
  >;
}

export interface LocalLlmProviderStatus {
  ready: boolean;
  message?: string;
  executable?: string;
  metrics: AiLocalLlmRuntimeMetrics;
}

/** Small provider boundary: ShangHao owns tasks/UI while the backend owns inference. */
export interface LocalLLMProvider {
  readonly modelId: "qwen36-35b-a3b-nvfp4";
  prepare(): Promise<LocalLlmProviderStatus>;
  status(): Promise<LocalLlmProviderStatus>;
  generateJson<T>(request: LocalLlmGenerateRequest): Promise<LocalLlmGenerateResult<T>>;
  release(reason: string): void;
  stop(): void;
  onStatus(listener: (status: LocalLlmProviderStatus) => void): () => void;
}
