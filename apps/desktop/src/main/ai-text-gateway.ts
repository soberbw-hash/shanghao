import type { AiTextProvider } from "@private-voice/shared";

import { AiModelManager } from "./ai-model-manager";
import { AiRuntimeManager } from "./ai-runtime-manager";
import { CustomAiProviderStore } from "./custom-ai-provider-store";
import { SettingsStore } from "./settings-store";
import { SignalingClientBridge } from "./signaling-client";

interface GenerateJsonRequest {
  purpose: "organize" | "question";
  prompt: string;
  maxNewTokens: number;
  timeoutMs?: number;
  manual: boolean;
  signal?: AbortSignal;
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

/** Routes summary/question work without coupling ASR to a particular text model. */
export class AiTextGateway {
  constructor(
    private readonly settings: SettingsStore,
    private readonly models: AiModelManager,
    private readonly runtime: AiRuntimeManager,
    private readonly signaling: SignalingClientBridge,
    private readonly customProvider: CustomAiProviderStore,
  ) {}

  async generateJson<T>(request: GenerateJsonRequest): Promise<T> {
    const provider = this.providerFor(request.purpose);
    if (provider === "cloud") {
      const content = await this.signaling.requestCloudAi({
        purpose: request.purpose,
        prompt: request.prompt,
        useWebSearch: request.purpose === "question",
        signal: request.signal,
      });
      return extractJsonObject<T>(content);
    }
    if (provider === "custom") {
      return this.customProvider.generateJson<T>({
        prompt: request.prompt,
        maxNewTokens: request.maxNewTokens,
        signal: request.signal,
      });
    }

    const taskKind = request.purpose === "organize" ? "summary" : "question";
    const runnable = this.models.canRunTask(taskKind, request.manual);
    if (!runnable.runnable) throw new Error(runnable.reason);
    this.models.markQwenTaskStarted(`${request.purpose}:local`);
    try {
      return await this.runtime.generateJson<T>({
        resourceMode: runnable.resourceMode,
        maxNewTokens: request.maxNewTokens,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        prompt: request.prompt,
      });
    } finally {
      this.models.markAiTaskFinished();
    }
  }

  private providerFor(purpose: GenerateJsonRequest["purpose"]): AiTextProvider {
    const snapshot = this.settings.getSnapshot();
    return purpose === "organize" ? snapshot.aiOrganizerProvider : snapshot.aiRoomAskProvider;
  }
}
