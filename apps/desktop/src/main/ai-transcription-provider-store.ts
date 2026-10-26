import { fetchPublicUrl, resolvePublicAddress } from "./public-network";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { app, safeStorage } from "electron";
import { readBoundedProviderFile, recoverAndMigrateProvider } from "./provider-encryption-recovery";
import { readAiProviderResponse } from "./ai-provider-response";
import type { BuiltInAiClient } from "./built-in-ai-client";

import type {
  AiTranscriptionProvider,
  AiTranscriptionProviderInput,
  AiTranscriptionProviderStatus,
} from "@private-voice/shared";

interface CustomAsrConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface StoredTranscriptionProvider {
  cloudApiKey?: string;
  custom?: CustomAsrConfig;
}

const CLOUD_BASE_URL = "https://api.siliconflow.cn/v1";
const CLOUD_MODEL = "FunAudioLLM/SenseVoiceSmall";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 60 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

const normalizeBaseUrl = (value: string): string => {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("custom_asr_https_required");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("custom_asr_url_not_allowed");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
};

const validatePublicHost = async (baseUrl: string): Promise<void> => {
  await resolvePublicAddress(new URL(baseUrl), "custom_asr_private_host_not_allowed");
};

const contentTypeFor = (filePath: string): string => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".ogg":
      return "audio/ogg";
    case ".opus":
      return "audio/opus";
    case ".webm":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
};

/** Keeps cloud/custom audio-provider credentials encrypted in the main process. */
export class AiTranscriptionProviderStore {
  private readonly filePath: string;

  constructor(
    userDataDirectory = app.getPath("userData"),
    private readonly secureStorage: Pick<
      typeof safeStorage,
      "isEncryptionAvailable" | "encryptString" | "decryptString"
    > = safeStorage,
    private readonly fetcher: typeof fetch = (input, init) =>
      String(input) === `${CLOUD_BASE_URL}/audio/transcriptions`
        ? fetch(input, init)
        : fetchPublicUrl(String(input), init, "custom_asr_private_host_not_allowed"),
    private readonly builtIn?: BuiltInAiClient,
  ) {
    this.filePath = path.join(userDataDirectory, "ai", "transcription-provider.enc");
  }

  async status(): Promise<AiTranscriptionProviderStatus> {
    let config: StoredTranscriptionProvider | undefined;
    let customConfigUnreadable = false;
    try {
      config = await this.read();
    } catch (error) {
      if (!this.builtIn) throw error;
      customConfigUnreadable = true;
    }
    const builtIn = this.builtIn ? await this.builtIn.status() : undefined;
    return {
      cloudConfigured: builtIn ? builtIn.transcriptionConfigured : Boolean(config?.cloudApiKey),
      ...(builtIn?.errorCode ? { cloudErrorCode: builtIn.errorCode } : {}),
      customConfigured: Boolean(config?.custom || (this.builtIn && config?.cloudApiKey)),
      customBaseUrl:
        config?.custom?.baseUrl ??
        (this.builtIn && config?.cloudApiKey ? CLOUD_BASE_URL : undefined),
      customModel:
        config?.custom?.model ?? (this.builtIn && config?.cloudApiKey ? CLOUD_MODEL : undefined),
      ...(customConfigUnreadable ? { customConfigUnreadable: true } : {}),
    };
  }

  async save(input: AiTranscriptionProviderInput): Promise<AiTranscriptionProviderStatus> {
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new Error("custom_asr_encryption_unavailable");
    }
    const previous = await this.read();
    const next: StoredTranscriptionProvider = { ...previous };
    if (input.provider === "cloud") {
      const apiKey = input.apiKey?.trim() || previous?.cloudApiKey;
      if (!apiKey || apiKey.length > 512) throw new Error("cloud_asr_key_required");
      next.cloudApiKey = apiKey;
    } else {
      const baseUrl = normalizeBaseUrl(input.baseUrl ?? "");
      await validatePublicHost(baseUrl);
      const model = input.model?.trim() ?? "";
      if (!model || model.length > 120) throw new Error("custom_asr_model_invalid");
      const retainedKey =
        previous?.custom && new URL(previous.custom.baseUrl).origin === new URL(baseUrl).origin
          ? previous.custom.apiKey
          : this.builtIn && new URL(baseUrl).origin === new URL(CLOUD_BASE_URL).origin
            ? previous?.cloudApiKey
            : undefined;
      const apiKey = input.apiKey?.trim() || retainedKey;
      if (!apiKey || apiKey.length > 512) throw new Error("custom_asr_key_required");
      next.custom = { baseUrl, model, apiKey };
    }
    const encrypted = this.secureStorage.encryptString(JSON.stringify(next));
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return this.status();
  }

  async clear(provider: "cloud" | "custom"): Promise<AiTranscriptionProviderStatus> {
    const current = (await this.read()) ?? {};
    if (provider === "cloud") delete current.cloudApiKey;
    else {
      delete current.custom;
      if (this.builtIn) delete current.cloudApiKey;
    }
    if (!current.cloudApiKey && !current.custom) {
      await rm(this.filePath, { force: true });
      return this.status();
    }
    const encrypted = this.secureStorage.encryptString(JSON.stringify(current));
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return this.status();
  }

  async transcribe(
    filePath: string,
    durationMs: number,
    provider: AiTranscriptionProvider,
    signal: AbortSignal,
  ): Promise<{ text: string; modelName: string }> {
    if (provider === "local") throw new Error("local_asr_provider_selected");
    if (durationMs > MAX_AUDIO_DURATION_MS) throw new Error("cloud_asr_duration_limit");
    const fileStats = await stat(filePath);
    if (fileStats.size <= 0 || fileStats.size > MAX_AUDIO_BYTES) {
      throw new Error("cloud_asr_file_size_limit");
    }
    if (provider === "cloud" && this.builtIn)
      return this.builtIn.transcribe(filePath, durationMs, signal);
    const config = await this.read();
    const custom =
      config?.custom ??
      (this.builtIn && config?.cloudApiKey
        ? { baseUrl: CLOUD_BASE_URL, model: CLOUD_MODEL, apiKey: config.cloudApiKey }
        : undefined);
    const baseUrl = provider === "cloud" ? CLOUD_BASE_URL : custom?.baseUrl;
    const model = provider === "cloud" ? CLOUD_MODEL : custom?.model;
    const apiKey = provider === "cloud" ? config?.cloudApiKey : custom?.apiKey;
    if (!baseUrl || !model || !apiKey) throw new Error(`${provider}_asr_not_configured`);
    if (provider === "custom") await validatePublicHost(baseUrl);

    const audio = await readFile(filePath);
    signal.throwIfAborted();
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: contentTypeFor(filePath) }),
      path.basename(filePath),
    );
    form.append("model", model);
    const timeoutMs = Math.max(120_000, Math.min(30 * 60_000, durationMs * 4));
    const requestFailed = (error: unknown): never => {
      if (signal.aborted) throw new Error("ai_task_paused");
      const networkCode = ((error as Error)?.cause as { code?: string } | undefined)?.code;
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
        throw new Error(`${provider}_asr_timeout`, { cause: error });
      if (
        error instanceof TypeError &&
        (error.message === "fetch failed" || error.message === "terminated") &&
        (!networkCode ||
          /^(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/.test(
            networkCode,
          ))
      ) {
        throw new Error(`${provider}_asr_network_error`, { cause: error });
      }
      throw error;
    };
    const response = await this.fetcher(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    }).catch(requestFailed);
    const body = await readAiProviderResponse(
      response,
      MAX_RESPONSE_BYTES,
      "cloud_asr_response_too_large",
    ).catch(requestFailed);
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`cloud_asr_http_${response.status}`);
    let payload: { text?: unknown };
    try {
      payload = JSON.parse(body) as { text?: unknown };
    } catch {
      throw new Error("cloud_asr_invalid_response");
    }
    if (typeof payload.text !== "string") {
      throw new Error("cloud_asr_invalid_response");
    }
    return { text: payload.text, modelName: model };
  }

  private async read(): Promise<StoredTranscriptionProvider | undefined> {
    let encrypted: Buffer;
    try {
      encrypted = await readBoundedProviderFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new Error("custom_asr_encryption_unavailable");
    }
    try {
      let plaintext: string;
      try {
        plaintext = this.secureStorage.decryptString(encrypted);
      } catch {
        const appData = app.getPath("appData");
        const profile = path.dirname(path.dirname(this.filePath));
        if (
          path.dirname(profile) !== appData ||
          !["shanghao", "shanghao-desktop"].includes(path.basename(profile))
        )
          throw Error("recovery_scope_invalid");
        const recovered = await recoverAndMigrateProvider(
          this.filePath,
          encrypted,
          appData,
          (input) => {
            const config = input as StoredTranscriptionProvider;
            const keyValid = (key: unknown) =>
              typeof key === "string" && key.trim().length > 0 && key.length <= 512;
            if (
              !config ||
              (!config.cloudApiKey && !config.custom) ||
              (config.cloudApiKey !== undefined && !keyValid(config.cloudApiKey))
            )
              throw Error("recovery_config_invalid");
            if (config.custom) {
              if (
                typeof config.custom.baseUrl !== "string" ||
                typeof config.custom.model !== "string" ||
                !config.custom.model.trim() ||
                config.custom.model.length > 120 ||
                !keyValid(config.custom.apiKey)
              )
                throw Error("recovery_config_invalid");
              normalizeBaseUrl(config.custom.baseUrl);
            }
          },
          (value) => this.secureStorage.encryptString(value),
        );
        plaintext = recovered;
      }
      const value = JSON.parse(plaintext) as StoredTranscriptionProvider;
      if (
        (value.cloudApiKey !== undefined && typeof value.cloudApiKey !== "string") ||
        (value.custom !== undefined &&
          (typeof value.custom.baseUrl !== "string" ||
            typeof value.custom.model !== "string" ||
            typeof value.custom.apiKey !== "string"))
      ) {
        throw new Error("custom_asr_config_invalid");
      }
      return value;
    } catch (error) {
      if (error instanceof Error && error.message === "custom_asr_config_invalid") throw error;
      throw new Error("custom_asr_config_unreadable", { cause: error });
    }
  }
}
