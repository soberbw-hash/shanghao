/** Provider codes only; never show an API response or credentials in the UI. */
export const transcriptionProviderError = (message: string): string | undefined => {
  if (message.includes("participant_track_room_mismatch"))
    return "成员音轨与这条录音所属房间不一致，已停止上传。原录音和已有文字均已保留。";
  if (message.includes("participant_track_audio_missing"))
    return "这条录音的成员音轨有文件缺失，已停止转录以避免漏掉成员。请检查录音数据是否被移动。";
  if (
    /participant_track_(?:path_invalid|manifest_invalid|manifest_missing|unindexed_audio)/.test(
      message,
    )
  )
    return "成员音轨索引无法安全读取，已停止上传。请保留原录音与本机数据，不要删除后重试。";
  if (!/(?:cloud|custom|remote)_asr_/.test(message)) return undefined;
  if (message.includes("cloud_asr_backend_upgrade_required"))
    return "内置云端转录接口尚未部署，需要更新服务器后台。录音和已有文字已保留；暂时可切换本地转录或自定义语音 API。";
  if (message.includes("cloud_asr_invalid_response"))
    return "云端转录返回了无法识别的结果，请检查服务器接口版本。录音和已有文字已保留。";
  if (message.includes("cloud_asr_not_configured"))
    return "内置云端转录暂不可用，请稍后重试或切换本地模型；无需填写开发者的密钥。";
  if (/cloud_asr_http_(?:401|402|403|404)/.test(message))
    return "内置云端转录服务配置或额度暂不可用，请稍后重试或使用本地模型。";
  if (message.includes("network_error") || message.includes("timeout"))
    return "转录网络连接中断或超时，自动重试后仍未完成。请稍后继续或切换本地模型。";
  if (message.includes("http_402"))
    return "转录服务返回账户余额不足。免费模型也可能受账户欠费限制，请在服务商控制台核对余额、实名认证和权限后重试。";
  if (message.includes("model_comparison_not_supported"))
    return "本地模型对比不能使用云端转录。普通转录请从录音详情点“开始转录”；模型对比请先切换本地模型。";
  if (message.includes("http_404")) return "当前转录模型或接口不可用，请检查模型名称与 API 地址。";
  if (message.includes("http_400") || message.includes("http_422"))
    return "转录服务不接受本次音频或参数，请检查音频格式、大小和模型支持范围。";
  if (message.includes("http_401")) return "转录 API 密钥无效或已失效，请在“AI 功能”中重新保存。";
  if (message.includes("http_403"))
    return "转录服务拒绝访问，请在服务商控制台检查实名认证和模型权限。";
  if (message.includes("http_429")) return "转录服务请求过于频繁，请稍后重试。";
  if (/http_5\d\d/.test(message))
    return "转录服务暂时不可用，自动重试后仍未完成。请稍后重试或切换本地模型。";
  if (message.includes("not_configured") || message.includes("key_required"))
    return "请先在“AI 功能 → 语音转文字”中保存此服务的密钥；与摘要模型密钥分开，正式版和开发版独立保存。";
  if (message.includes("file_size_limit"))
    return "音频片段为空或超过服务限制，请重新转录以自动分段，或切换本地模型。";
  if (message.includes("duration_limit"))
    return "云端片段时长超过限制，请重新转录以自动分段，或切换本地模型。";
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
