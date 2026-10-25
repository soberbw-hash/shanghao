import { fetchPublicUrl, resolvePublicAddress } from "./public-network";
import { customAiHttpError } from "./custom-ai-error";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app, safeStorage } from "electron";
import { readBoundedProviderFile, recoverAndMigrateProvider } from "./provider-encryption-recovery";

import type {
  AiCustomProviderInput,
  AiCustomProviderStatus,
  RendererLogPayload,
} from "@private-voice/shared";

interface StoredCustomProvider {
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface GenerateRequest {
  prompt: string;
  maxNewTokens: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
const isBuiltInProviderUrl = (baseUrl: string): boolean =>
  baseUrl === "https://open.bigmodel.cn/api/paas/v4" || baseUrl === "https://api.deepseek.com";

const normalizeProviderUrl = (value: string): string => {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error("custom_ai_https_required");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("custom_ai_url_not_allowed");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
};

const validatePublicProviderHost = async (baseUrl: string): Promise<void> => {
  // Fixed built-in HTTPS endpoints also work with Clash's local fake-IP DNS.
  // Arbitrary custom URLs still go through the public-address check below.
  if (isBuiltInProviderUrl(baseUrl)) return;
  await resolvePublicAddress(new URL(baseUrl), "custom_ai_private_host_not_allowed");
};

const readBoundedText = async (response: Response): Promise<string> => {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("custom_ai_response_too_large");
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error("custom_ai_response_too_large");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel("custom_ai_response_too_large");
        throw new Error("custom_ai_response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
};

const extractJsonObject = <T>(value: string): T => {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("custom_ai_invalid_json");
  try {
    return JSON.parse(value.slice(start, end + 1)) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const jsonSyntax = message.includes("double-quoted property")
      ? "object_key"
      : message.includes("Expected ','")
        ? "delimiter"
        : message.includes("control character")
          ? "control_character"
          : message.includes("Unterminated string")
            ? "unterminated_string"
            : "other";
    throw Object.assign(new Error("custom_ai_invalid_json"), { jsonSyntax });
  }
};

/** Stores a user-supplied API key encrypted by Windows DPAPI and never returns it to the renderer. */
export class CustomAiProviderStore {
  private readonly filePath: string;

  constructor(
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
    userDataDirectory = app.getPath("userData"),
    private readonly secureStorage: Pick<
      typeof safeStorage,
      "isEncryptionAvailable" | "encryptString" | "decryptString"
    > = safeStorage,
  ) {
    this.filePath = path.join(userDataDirectory, "ai", "custom-provider.enc");
  }

  async status(): Promise<AiCustomProviderStatus> {
    const config = await this.read();
    return {
      configured: Boolean(config),
      baseUrl: config?.baseUrl,
      model: config?.model,
      hasApiKey: Boolean(config?.apiKey),
    };
  }

  async save(input: AiCustomProviderInput): Promise<AiCustomProviderStatus> {
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new Error("custom_ai_encryption_unavailable");
    }
    const previous = await this.read();
    const baseUrl = normalizeProviderUrl(input.baseUrl);
    await validatePublicProviderHost(baseUrl);
    const model = input.model.trim();
    if (!model || model.length > 120) throw new Error("custom_ai_model_invalid");
    // Never carry a credential to another provider (or port) through a preset switch.
    const retainedKey =
      previous && new URL(previous.baseUrl).origin === new URL(baseUrl).origin
        ? previous.apiKey
        : undefined;
    const apiKey = input.apiKey?.trim() || retainedKey;
    if (!apiKey || apiKey.length > 512) throw new Error("custom_ai_key_required");

    const encrypted = this.secureStorage.encryptString(JSON.stringify({ baseUrl, model, apiKey }));
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    await this.log("info", "Custom AI provider saved", { baseUrl, model });
    return { configured: true, baseUrl, model, hasApiKey: true };
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
    await this.log("info", "Custom AI provider cleared");
  }

  async generateJson<T>(request: GenerateRequest): Promise<T> {
    const config = await this.requireConfig();
    await validatePublicProviderHost(config.baseUrl);
    const requestUrl = `${config.baseUrl}/chat/completions`;
    const timeoutMs = Math.max(10000, Math.min(180000, request.timeoutMs ?? 60000));
    const requestSignal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const requestFailed = (error: unknown): never => {
      if (request.signal?.aborted) throw new Error("ai_task_paused");
      if (requestSignal.aborted) throw new Error("custom_ai_timeout");
      if (error instanceof TypeError && /fetch failed|terminated/i.test(error.message))
        throw new Error("custom_ai_network_error");
      throw error;
    };
    const fetcher = isBuiltInProviderUrl(config.baseUrl) ? fetch : fetchPublicUrl;
    const response = await fetcher(requestUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content: "请严格按照用户要求返回一个 JSON 对象，不要输出 Markdown 或额外解释。",
          },
          { role: "user", content: request.prompt },
        ],
        max_tokens: Math.max(128, Math.min(4_096, request.maxNewTokens)),
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal: requestSignal,
    }).catch(requestFailed);
    const payloadText = await readBoundedText(response).catch(requestFailed);
    if (!response.ok) {
      const failure = customAiHttpError(config.baseUrl, response.status, payloadText);
      await this.log("warn", "Custom AI provider request failed", {
        status: response.status,
        businessCode: failure.businessCode,
      });
      throw new Error(failure.message);
    }
    let content: unknown;
    let finishReason: string | undefined;
    try {
      const payload = JSON.parse(payloadText) as {
        choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }>;
      };
      if (payload.choices?.[0]?.finish_reason === "length")
        throw new Error("custom_ai_response_truncated");
      finishReason = ["stop", "length", "sensitive", "content_filter"].includes(
        payload.choices?.[0]?.finish_reason ?? "",
      )
        ? payload.choices?.[0]?.finish_reason
        : "other";
      content = payload.choices?.[0]?.message?.content;
    } catch (error) {
      if ((error as Error).message === "custom_ai_response_truncated") throw error;
      // Parser errors can contain a provider response excerpt. Keep diagnostics content-free.
      // eslint-disable-next-line preserve-caught-error
      throw new Error("custom_ai_invalid_response");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("custom_ai_empty_response");
    }
    try {
      return extractJsonObject<T>(content);
    } catch (error) {
      await this.log("warn", "Custom AI provider returned invalid JSON", {
        contentLength: content.length,
        startsObject: content.trimStart().startsWith("{"),
        endsObject: content.trimEnd().endsWith("}"),
        startsArray: content.trimStart().startsWith("["),
        markdownFence: content.trimStart().startsWith("```"),
        finishReason,
        jsonSyntax: (error as { jsonSyntax?: string })?.jsonSyntax ?? "object_boundary",
      });
      throw new Error("custom_ai_invalid_json", { cause: error });
    }
  }

  private async requireConfig(): Promise<StoredCustomProvider> {
    const config = await this.read();
    if (!config) throw new Error("custom_ai_not_configured");
    return config;
  }

  private async read(): Promise<StoredCustomProvider | undefined> {
    let encrypted: Buffer;
    try {
      encrypted = await readBoundedProviderFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new Error("custom_ai_encryption_unavailable");
    }
    let parsed: Partial<StoredCustomProvider>;
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
          (value) => {
            const config = value as Partial<StoredCustomProvider>;
            if (
              !config ||
              typeof config.baseUrl !== "string" ||
              typeof config.model !== "string" ||
              !config.model.trim() ||
              config.model.length > 120 ||
              typeof config.apiKey !== "string" ||
              !config.apiKey.trim() ||
              config.apiKey.length > 512
            )
              throw Error("recovery_config_invalid");
            normalizeProviderUrl(config.baseUrl);
          },
          (value) => this.secureStorage.encryptString(value),
        );
        plaintext = recovered;
      }
      parsed = JSON.parse(plaintext) as Partial<StoredCustomProvider>;
    } catch {
      throw new Error("custom_ai_config_unreadable");
    }
    if (
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.model !== "string" ||
      typeof parsed.apiKey !== "string"
    ) {
      throw new Error("custom_ai_config_invalid");
    }
    return {
      baseUrl: normalizeProviderUrl(parsed.baseUrl),
      model: parsed.model,
      apiKey: parsed.apiKey,
    };
  }

  private async log(
    level: RendererLogPayload["level"],
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeLog?.({ category: "app", level, message, context });
  }
}
