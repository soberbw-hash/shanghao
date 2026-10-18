/** Provider codes only; never show an API response or credentials in the UI. */
export const transcriptionProviderError = (message: string): string | undefined => {
  if (!/(?:cloud|custom|remote)_asr_/.test(message)) return undefined;
  if (message.includes("http_402"))
    return "转录服务账户余额不足。请到服务商控制台检查账户状态，或切换本地模型。";
  if (message.includes("http_401")) return "转录 API 密钥无效或已失效，请在“AI 功能”中重新保存。";
  if (message.includes("http_403"))
    return "转录服务拒绝访问，请在服务商控制台检查实名认证和模型权限。";
  if (message.includes("http_429")) return "转录服务请求过于频繁，请稍后重试。";
  if (message.includes("not_configured") || message.includes("key_required"))
    return "请先在“AI 功能 → 语音转录”中保存 API 密钥。";
  if (message.includes("file_size_limit"))
    return "云端转录单文件需要大于 0 且不超过 50 MB，请选择较短录音或切换本地模型。";
  if (message.includes("duration_limit"))
    return "云端转录单文件最长 1 小时，请选择较短录音或切换本地模型。";
  if (
    message.includes("https_required") ||
    message.includes("url_not_allowed") ||
    message.includes("private_host")
  )
    return "请填写有效的公网 HTTPS 转录 API 地址。";
  if (message.includes("config_unreadable") || message.includes("config_invalid"))
    return "转录 API 配置无法读取，原配置已保留。请检查本机加密存储。";
  if (message.includes("encryption_unavailable")) return "Windows 加密存储暂不可用，密钥尚未保存。";
  if (message.includes("empty_response") || message.includes("unusable_transcript"))
    return "云端没有返回可用的语音文字，请确认录音内容后重试。";
  return "转录 API 请求未完成，请检查服务状态或切换本地模型后重试。";
};
