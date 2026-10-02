import { isStoredRoomId, type AiTextProvider } from "@private-voice/shared";

import type { AiModelManager } from "./ai-model-manager";
import type { AiRuntimeManager } from "./ai-runtime-manager";
import type { CustomAiProviderStore } from "./custom-ai-provider-store";
import type { SettingsStore } from "./settings-store";
import type { SignalingClientBridge } from "./signaling-client";
import type { LocalLLMProvider, LocalLlmGenerateResult } from "./local-llm-provider";

export type AiTextPurpose = "organize" | "question";

export interface GenerateJsonRequest {
  purpose: AiTextPurpose;
  prompt: string;
  maxNewTokens: number;
  timeoutMs?: number;
  manual: boolean;
  signal?: AbortSignal;
  roomId?: string;
  provider?: AiTextProvider;
}

export interface GeneratedJson<T> {
  value: T;
  metrics?: LocalLlmGenerateResult<T>["metrics"];
}

const extractJsonObject = <T>(value: string): T => {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("ai_invalid_json_response");
  try {
    return JSON.parse(value.slice(start, end + 1)) as T;
  } catch {
    throw new Error("ai_invalid_json_response");
  }
};

export const resolveAiTextProvider = (
  _purpose: AiTextPurpose,
  organizerProvider: AiTextProvider,
): AiTextProvider => (organizerProvider === "custom" ? "custom" : "cloud");

/** Routes summary/question work without coupling ASR to a particular text model. */
export class AiTextGateway {
  constructor(
    private readonly settings: SettingsStore,
    private readonly models: AiModelManager,
    private readonly runtime: AiRuntimeManager,
    private readonly signaling: SignalingClientBridge,
    private readonly customProvider: CustomAiProviderStore,
    private readonly localLlm: LocalLLMProvider,
    private readonly memoryContext?: (roomId: string, signal?: AbortSignal) => Promise<string>,
  ) {}

  async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
    return (await this.generateJsonWithMetrics<T>(request)).value;
  }

  usesLocalOrganizer(): boolean {
    return this.providerFor("organize") === "local";
  }

  organizerProvider(): "cloud" | "custom" {
    return this.providerFor("organize") === "custom" ? "custom" : "cloud";
  }

  questionRoomId(): string | undefined {
    return this.signaling.getJoinedRoomId();
  }

  async generateJsonWithMetrics<T>(request: GenerateJsonRequest): Promise<GeneratedJson<T>> {
    const provider = this.providerFor(request.purpose);
    if (request.provider && request.provider !== provider) throw new Error("ai_provider_changed");
    if (provider === "cloud") {
      if (request.purpose === "organize" && !isStoredRoomId(request.roomId))
        throw new Error("cloud_ai_join_matching_room");
      const content = await this.signaling.requestCloudAi({
        roomId: request.roomId,
        purpose: request.purpose,
        prompt: request.prompt,
        useWebSearch: request.purpose === "question",
        signal: request.signal,
      });
      return { value: extractJsonObject<T>(content) };
    }
    if (provider === "custom") {
      const roomId = request.roomId ?? this.questionRoomId();
      const memory = roomId ? await this.memoryContext?.(roomId, request.signal) : undefined;
      request.signal?.throwIfAborted();
      return {
        value: await this.customProvider.generateJson<T>({
          prompt: memory ? `${memory}\n\n${request.prompt}` : request.prompt,
          maxNewTokens: request.maxNewTokens,
          signal: request.signal,
        }),
      };
    }

    const taskKind = request.purpose === "organize" ? "summary" : "question";
    const runnable = this.models.canRunTask(taskKind, request.manual);
    if (!runnable.runnable) throw new Error(runnable.reason);
    const compute = await this.models.acquireComputeSlot(taskKind, request.manual, request.signal);
    const taskId = this.models.markQwenTaskStarted(`${request.purpose}:local`);
    try {
      // The target machine has 8 GB VRAM and 32 GB RAM. ASR is explicitly released before
      // FreeToken starts, while one complete organization run keeps the LLM loaded.
      await this.runtime.releaseAsrMeasured("local_llm_organization_start");
      return await this.localLlm.generateJson<T>({
        maxNewTokens: request.maxNewTokens,
        timeoutMs: request.timeoutMs ?? 30 * 60_000,
        signal: compute.signal,
        prompt: request.prompt,
      });
    } finally {
      this.models.markAiTaskFinished(taskId);
      compute.release();
    }
  }

  private providerFor(purpose: AiTextPurpose): AiTextProvider {
    const snapshot = this.settings.getSnapshot();
    return resolveAiTextProvider(purpose, snapshot.aiOrganizerProvider);
  }
}
