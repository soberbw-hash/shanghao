/** Known transport/provider codes only; never expose raw responses or credentials. */
export const roomAiError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    cloud_ai_balance_insufficient: "AI 账户余额不足，请充值后重试。",
    cloud_ai_auth_failed: "AI API 认证失败，请检查服务器的 API 密钥。",
    cloud_ai_not_configured: "房间 AI 尚未配置，请检查服务器的 API 设置。",
    cloud_ai_configuration_invalid: "AI API 地址配置有误，请检查服务器设置。",
    cloud_ai_join_required: "请先进入房间，再使用上号 AI。",
    cloud_ai_unsupported: "房间服务器尚不支持 AI，请更新服务器。",
    cloud_ai_busy: "AI 服务繁忙，请稍后重试。",
    cloud_ai_request_in_progress: "上一条问题仍在处理，请先停止它。",
    ai_question_in_progress: "上一条问题仍在处理，请先停止它。",
    cloud_ai_timeout: "AI 回答超时，问题已保留，可以重试。",
    cloud_ai_connection_closed: "房间连接已断开，恢复连接后再试。",
    cloud_ai_send_failed: "问题未发送成功，恢复连接后再试。",
    cloud_ai_provider_unavailable: "AI 服务暂时不可用，请稍后重试。",
    cloud_ai_unavailable: "AI 请求未完成，请检查服务器与 API 的连接。",
    cloud_ai_request_failed: "AI API 拒绝了请求，请检查服务器配置。",
    cloud_ai_invalid_response: "AI 返回了无效结果，问题已保留，可以重试。",
    ai_invalid_json_response: "AI 回答格式异常，问题已保留，可以重试。",
    qwen_invalid_json_response: "AI 回答格式异常，问题已保留，可以重试。",
    ai_task_paused: "回答已停止，可以重新提问。",
    cloud_ai_cancelled: "回答已停止，可以重新提问。",
    waiting_for_game_to_finish: "当前设置为游戏结束后处理，请稍后再问。",
    model_qwen35: "请完全退出并重新打开上号，切换至房间云端 AI。",
    qwen_runtime_unavailable: "请完全退出并重新打开上号，切换至房间云端 AI。",
  };
  return (
    Object.entries(messages).find(([code]) => message.includes(code))?.[1] ??
    "这次没有得到结果，请稍后重试。"
  );
};
