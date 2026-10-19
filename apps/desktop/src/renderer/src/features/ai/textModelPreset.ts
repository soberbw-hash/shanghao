import type { AiCustomProviderStatus, AppSettings } from "@private-voice/shared";

export type TextModelPreset = NonNullable<AppSettings["aiTextModelPreset"]>;
export const textModelPreset = (
  status?: Pick<AiCustomProviderStatus, "baseUrl" | "model">,
): TextModelPreset => {
  if (status?.baseUrl === "https://api.deepseek.com" && status.model === "deepseek-flash")
    return "deepseek";
  if (
    status?.baseUrl === "https://open.bigmodel.cn/api/paas/v4" &&
    status.model === "glm-4-flash-250414"
  )
    return "glm";
  return "custom";
};

export const canReuseTextProviderKey = (
  saved: AiCustomProviderStatus | undefined,
  baseUrl: string,
): boolean => {
  if (!saved?.hasApiKey || !saved.baseUrl) return false;
  try {
    return new URL(saved.baseUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
};
