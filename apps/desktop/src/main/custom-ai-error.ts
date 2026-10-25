const glmErrors: Record<string, string> = {
  "1301": "custom_ai_content_rejected",
  "1261": "custom_ai_prompt_too_long",
  "1113": "custom_ai_account_unavailable",
  "1302": "custom_ai_rate_limited",
  "1305": "custom_ai_rate_limited",
};

/** Only a fixed provider's documented numeric codes; never propagate its message or body. */
export function customAiHttpError(baseUrl: string, status: number, body: string) {
  let code: unknown;
  if (baseUrl === "https://open.bigmodel.cn/api/paas/v4") {
    try {
      code = JSON.parse(body)?.error?.code;
    } catch {
      // Non-JSON errors remain ordinary HTTP failures.
    }
  }
  const known = typeof code === "string" && Object.hasOwn(glmErrors, code) ? code : undefined;
  return {
    message: (known && glmErrors[known]) || `custom_ai_http_${status}`,
    businessCode: known,
  };
}
