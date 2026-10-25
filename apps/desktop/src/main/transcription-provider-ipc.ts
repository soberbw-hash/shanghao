import { ipcMain } from "electron";
import { IPC_CHANNELS, type AiTranscriptionProviderInput } from "@private-voice/shared";
import type { AiTranscriptionProviderStore } from "./ai-transcription-provider-store";
import { aiModelConfigurationUsage } from "./ai-model-configuration-usage";

const bounded = (value: unknown, maximum: number, label: string): string => {
  if (typeof value !== "string" || value.length > maximum) throw new Error(`invalid_${label}`);
  return value;
};

/** Explicit credential capabilities: keys never leave the main process. */
export const registerTranscriptionProviderIpc = (store: AiTranscriptionProviderStore): void => {
  ipcMain.handle(IPC_CHANNELS.ai.getTranscriptionProvider, () => store.status());
  ipcMain.handle(
    IPC_CHANNELS.ai.saveTranscriptionProvider,
    (_event, input: AiTranscriptionProviderInput) => {
      if (input?.provider !== "cloud" && input?.provider !== "custom")
        throw new Error("invalid_asr_provider");
      return aiModelConfigurationUsage.change(() =>
        store.save({
          provider: input.provider,
          apiKey: input.apiKey === undefined ? undefined : bounded(input.apiKey, 512, "asr_key"),
          baseUrl:
            input.baseUrl === undefined ? undefined : bounded(input.baseUrl, 2048, "asr_base_url"),
          model: input.model === undefined ? undefined : bounded(input.model, 120, "asr_model"),
        }),
      );
    },
  );
  ipcMain.handle(IPC_CHANNELS.ai.clearTranscriptionProvider, (_event, provider: unknown) => {
    if (provider !== "cloud" && provider !== "custom") throw new Error("invalid_asr_provider");
    return aiModelConfigurationUsage.change(() => store.clear(provider));
  });
};
