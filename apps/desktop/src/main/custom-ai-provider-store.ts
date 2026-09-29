import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app, safeStorage } from "electron";

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
}

const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;

const isPrivateIpv4 = (address: string): boolean => {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [first = 256, second = 256] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
};

const isPrivateAddress = (address: string): boolean => {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
};

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
  const url = new URL(baseUrl);
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error("custom_ai_private_host_not_allowed");
    return;
  }
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("custom_ai_private_host_not_allowed");
  }
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
  } catch {
    throw new Error("custom_ai_invalid_json");
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
    const apiKey = input.apiKey?.trim() || previous?.apiKey;
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
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    }).catch((error) => {
      if (request.signal?.aborted) throw new Error("ai_task_paused");
      throw error;
    });
    const payloadText = await readBoundedText(response);
    if (!response.ok) {
      await this.log("warn", "Custom AI provider request failed", { status: response.status });
      throw new Error(`custom_ai_http_${response.status}`);
    }
    let content: unknown;
    try {
      const payload = JSON.parse(payloadText) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      content = payload.choices?.[0]?.message?.content;
    } catch {
      throw new Error("custom_ai_invalid_response");
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("custom_ai_empty_response");
    }
    return extractJsonObject<T>(content);
  }

  private async requireConfig(): Promise<StoredCustomProvider> {
    const config = await this.read();
    if (!config) throw new Error("custom_ai_not_configured");
    return config;
  }

  private async read(): Promise<StoredCustomProvider | undefined> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new Error("custom_ai_encryption_unavailable");
    }
    let parsed: Partial<StoredCustomProvider>;
    try {
      parsed = JSON.parse(
        this.secureStorage.decryptString(encrypted),
      ) as Partial<StoredCustomProvider>;
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
