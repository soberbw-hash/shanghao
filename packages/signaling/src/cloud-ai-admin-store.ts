import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { CloudAiAdminMutation, CloudAiAdminSnapshot } from "@private-voice/shared";

interface Provider {
  id: string;
  kind: "text" | "speech";
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  active: boolean;
  fallback?: boolean;
}
interface State {
  revision: number;
  providers: Provider[];
}
const text = (value: unknown, max: number, empty = false): string => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw Error("cloud_ai_admin_invalid_input");
  return value.trim();
};
// Only server-reviewed public provider domains are accepted. Redirects remain forbidden.
const HOSTS = new Set([
  "open.bigmodel.cn",
  "api.siliconflow.cn",
  "api.deepseek.com",
  "api.openai.com",
]);
export const adminProviderUrl = (value: unknown): string => {
  const url = new URL(text(value, 1024));
  if (
    url.protocol !== "https:" ||
    !HOSTS.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("cloud_ai_admin_provider_not_supported");
  return url.toString().replace(/\/+$/, "");
};
const validate = (raw: unknown): State => {
  const state = raw as State;
  if (
    !state ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.providers) ||
    state.providers.length > 16
  )
    throw Error("cloud_ai_admin_storage_invalid");
  const ids = new Set<string>();
  const active = new Set<string>();
  const providers = state.providers.map((p) => {
    if (
      !p ||
      !["text", "speech"].includes(p.kind) ||
      typeof p.active !== "boolean" ||
      (p.fallback !== undefined && typeof p.fallback !== "boolean") ||
      (p.fallback && (p.kind !== "text" || p.active))
    )
      throw Error("cloud_ai_admin_storage_invalid");
    const id = text(p.id, 64);
    if (ids.has(id) || (p.active && active.has(p.kind)))
      throw Error("cloud_ai_admin_storage_invalid");
    ids.add(id);
    if (p.active) active.add(p.kind);
    if (p.fallback && active.has("fallback")) throw Error("cloud_ai_admin_storage_invalid");
    if (p.fallback) active.add("fallback");
    return {
      id,
      kind: p.kind,
      active: p.active,
      ...(p.fallback ? { fallback: true } : {}),
      name: text(p.name, 80),
      baseUrl: adminProviderUrl(p.baseUrl),
      model: text(p.model, 160),
      apiKey: text(p.apiKey, 8192, true),
    };
  });
  return { revision: state.revision, providers };
};

/** Server-only durable secrets; snapshots never expose keys, including to administrators. */
export class CloudAiAdminStore {
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private state: State,
    private readonly file?: string,
  ) {}
  static async open(
    file?: string,
    environment: NodeJS.ProcessEnv = process.env,
  ): Promise<CloudAiAdminStore> {
    let state: State;
    try {
      if (!file) throw Object.assign(Error(), { code: "ENOENT" });
      const meta = await lstat(file);
      if (
        !meta.isFile() ||
        meta.isSymbolicLink() ||
        meta.size > 192 * 1024 ||
        (process.platform !== "win32" && meta.mode & 0o077)
      )
        throw Error("cloud_ai_admin_storage_invalid");
      state = validate(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("cloud_ai_admin_storage_invalid", { cause: error });
      const legacyTextBaseUrl =
        environment.CLOUD_AI_BASE_URL?.trim() ||
        environment.CLOUD_AI_FALLBACK_BASE_URL?.trim() ||
        "https://open.bigmodel.cn/api/paas/v4";
      const legacyTextModel =
        environment.CLOUD_AI_MODEL?.trim() ||
        environment.CLOUD_AI_FALLBACK_MODEL?.trim() ||
        "glm-4-flash-250414";
      const isGlmUrl = (value: string | undefined) => {
        try {
          return (
            new URL(value || "https://open.bigmodel.cn/api/paas/v4").hostname === "open.bigmodel.cn"
          );
        } catch {
          return false;
        }
      };
      const deepseekApiKey = environment.DEEPSEEK_API_KEY?.trim();
      const glmBaseUrl =
        environment.GLM_BASE_URL?.trim() ||
        (isGlmUrl(environment.CLOUD_AI_FALLBACK_BASE_URL)
          ? environment.CLOUD_AI_FALLBACK_BASE_URL?.trim()
          : undefined) ||
        (isGlmUrl(environment.CLOUD_AI_BASE_URL)
          ? environment.CLOUD_AI_BASE_URL?.trim()
          : undefined) ||
        "https://open.bigmodel.cn/api/paas/v4";
      const glmModel =
        environment.GLM_MODEL?.trim() ||
        (environment.CLOUD_AI_FALLBACK_MODEL?.trim().startsWith("glm-")
          ? environment.CLOUD_AI_FALLBACK_MODEL.trim()
          : undefined) ||
        (environment.CLOUD_AI_MODEL?.trim().startsWith("glm-")
          ? environment.CLOUD_AI_MODEL.trim()
          : undefined) ||
        "glm-4-flash-250414";
      const glmApiKey = deepseekApiKey
        ? environment.GLM_API_KEY?.trim() ||
          (!environment.CLOUD_AI_FALLBACK_BASE_URL?.trim() ||
          isGlmUrl(environment.CLOUD_AI_FALLBACK_BASE_URL)
            ? environment.CLOUD_AI_FALLBACK_API_KEY?.trim()
            : undefined) ||
          (isGlmUrl(environment.CLOUD_AI_BASE_URL)
            ? environment.CLOUD_AI_API_KEY?.trim()
            : undefined)
        : undefined;
      const textProviders = deepseekApiKey
        ? [
            {
              id: "builtin-text",
              kind: "text" as const,
              name: "DeepSeek",
              baseUrl: environment.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
              model: environment.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
              apiKey: deepseekApiKey,
              active: true,
            },
            ...(glmApiKey
              ? [
                  {
                    id: "builtin-text-glm-fallback",
                    kind: "text" as const,
                    name: "智谱 GLM 备用",
                    baseUrl: glmBaseUrl,
                    model: glmModel,
                    apiKey: glmApiKey,
                    active: false,
                    fallback: true,
                  },
                ]
              : []),
          ]
        : [
            {
              id: "builtin-text",
              kind: "text" as const,
              name: "内置文字服务",
              baseUrl:
                environment.GLM_BASE_URL?.trim() ||
                (environment.GLM_API_KEY?.trim() ? glmBaseUrl : legacyTextBaseUrl),
              model:
                environment.GLM_MODEL?.trim() ||
                (environment.GLM_API_KEY?.trim() ? glmModel : legacyTextModel),
              apiKey:
                environment.GLM_API_KEY?.trim() ||
                environment.CLOUD_AI_API_KEY?.trim() ||
                environment.CLOUD_AI_FALLBACK_API_KEY?.trim() ||
                "",
              active: true,
            },
          ];
      state = validate({
        revision: 0,
        providers: [
          ...textProviders,
          {
            id: "builtin-speech",
            kind: "speech",
            name: "内置语音服务",
            baseUrl: "https://api.siliconflow.cn/v1",
            model: "FunAudioLLM/SenseVoiceSmall",
            apiKey: environment.SILICONFLOW_API_KEY || "",
            active: true,
          },
        ],
      });
    }
    return new CloudAiAdminStore(state, file);
  }
  snapshot(): CloudAiAdminSnapshot {
    return {
      revision: this.state.revision,
      providers: this.state.providers.map(({ apiKey, ...provider }) => ({
        ...provider,
        hasKey: Boolean(apiKey),
      })),
    };
  }
  provider(kind: Provider["kind"]): Readonly<Provider> | undefined {
    const provider = this.state.providers.find((p) => p.kind === kind && p.active && p.apiKey);
    return provider ? { ...provider } : undefined;
  }
  fallbackTextProvider(): Readonly<Provider> | undefined {
    const provider = this.state.providers.find((p) => p.kind === "text" && p.fallback && p.apiKey);
    return provider ? { ...provider } : undefined;
  }
  mutate(input: CloudAiAdminMutation): Promise<CloudAiAdminSnapshot> {
    const operation = this.queue.then(async () => {
      if (!this.file) throw Error("cloud_ai_admin_storage_not_configured");
      if (!input || input.revision !== this.state.revision) throw Error("cloud_ai_admin_conflict");
      let providers = this.state.providers.map((p) => ({ ...p }));
      if (input.action === "save") {
        const p = input.provider;
        const old = p?.id ? providers.find((candidate) => candidate.id === p.id) : undefined;
        if (
          !p ||
          (p.id && !old) ||
          !["text", "speech"].includes(p.kind) ||
          (old && old.kind !== p.kind)
        )
          throw Error("cloud_ai_admin_invalid_input");
        const next = {
          id: old?.id ?? randomUUID(),
          kind: p.kind,
          name: text(p.name, 80),
          baseUrl: adminProviderUrl(p.baseUrl),
          model: text(p.model, 160),
          apiKey: p.apiKey?.trim() ? text(p.apiKey, 8192) : (old?.apiKey ?? ""),
          active: old?.active ?? false,
          ...(old?.fallback ? { fallback: true } : {}),
        };
        if (!next.apiKey) throw Error("cloud_ai_admin_key_required");
        providers = old
          ? providers.map((entry) => (entry.id === old.id ? next : entry))
          : [...providers, next];
      } else if (
        ["activate", "disable", "delete", "set-fallback", "clear-fallback"].includes(input.action)
      ) {
        const selected = providers.find((p) => p.id === input.id);
        if (!selected) throw Error("cloud_ai_admin_not_found");
        if (input.action === "delete") providers = providers.filter((p) => p.id !== input.id);
        else if (input.action === "disable") {
          selected.active = false;
          selected.fallback = false;
        } else if (input.action === "clear-fallback") selected.fallback = false;
        else if (input.action === "set-fallback") {
          if (selected.kind !== "text" || selected.active || !selected.apiKey)
            throw Error("cloud_ai_admin_invalid_input");
          for (const p of providers) if (p.kind === "text") p.fallback = p.id === selected.id;
        } else {
          if (!selected.apiKey) throw Error("cloud_ai_admin_key_required");
          selected.fallback = false;
          for (const p of providers) if (p.kind === selected.kind) p.active = p.id === selected.id;
        }
      } else throw Error("cloud_ai_admin_invalid_input");
      const next = validate({ revision: this.state.revision + 1, providers });
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await this.write(`${this.file}.previous`, this.state);
      await this.write(this.file, next);
      this.state = next;
      return this.snapshot();
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private async write(file: string, state: State): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
