import { ipcMain } from "electron";
import { IPC_CHANNELS, type AiCustomProviderInput } from "@private-voice/shared";
import type { CustomAiProviderStore } from "./custom-ai-provider-store";
import { aiModelConfigurationUsage } from "./ai-model-configuration-usage";

const bounded = (value: unknown, max: number, label: string): string => {
  if (typeof value !== "string" || value.length > max) throw new Error(`invalid_${label}`);
  return value;
};

/** Keep credential validation and the task lock together at the mutation boundary. */
export const registerAiTextProviderIpc = (store: CustomAiProviderStore): void => {
  ipcMain.handle(IPC_CHANNELS.ai.getCustomProvider, () => store.status());
  ipcMain.handle(IPC_CHANNELS.ai.saveCustomProvider, (_event, input: AiCustomProviderInput) => {
    return aiModelConfigurationUsage.change(() =>
      store.save({
        baseUrl: bounded(input?.baseUrl, 2048, "custom_ai_base_url"),
        model: bounded(input?.model, 120, "custom_ai_model"),
        apiKey:
          input?.apiKey === undefined ? undefined : bounded(input.apiKey, 512, "custom_ai_key"),
      }),
    );
  });
  ipcMain.handle(IPC_CHANNELS.ai.clearCustomProvider, () => {
    return aiModelConfigurationUsage.change(() => store.clear());
  });
};
