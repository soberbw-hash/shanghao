const ACCOUNT_ERROR_PATTERN = /(account_[a-z0-9_]+)/i;

export const accountErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return ACCOUNT_ERROR_PATTERN.exec(message)?.[1]?.toLowerCase() ?? "account_request_failed";
};

const messages: Record<string, string> = {
  account_invalid_credentials: "账号或密码不正确。请检查后重试，或使用“忘记密码”。",
  account_username_invalid: "用户名需为 3～20 位，只能使用小写字母、数字、下划线或短横线。",
  account_username_reserved: "这个用户名为系统保留名称，请换一个。",
  account_username_taken: "这个用户名已被使用，请换一个。",
  account_email_invalid: "邮箱格式不正确，请检查邮箱地址。",
  account_email_taken: "这个邮箱已经注册，可以直接登录或找回密码。",
  account_password_weak: "密码至少 8 位，请使用更长且不易猜的密码。",
  account_rate_limited: "尝试次数较多，请稍等一分钟后再试。",
  account_session_expired: "登录已过期，请重新登录。",
  account_server_not_configured: "账号服务器地址尚未配置。开发时请先填写服务器地址。",
  account_server_upgrade_required:
    "当前房间服务器还是旧版本，尚未部署账号接口。更新服务器后即可测试；这与 HTTPS/WSS 是两个独立问题。",
  account_not_configured: "账号服务器还没有接入 Supabase，注册和登录暂不可用。",
  account_server_invalid_response: "服务器尚未启用账号服务。开发测试可先使用访客模式。",
  account_email_verification_required: "请先完成邮箱验证，再返回登录。",
  account_server_unreachable: "暂时连不上账号服务器，请检查网络后重试。",
  account_secure_transport_required:
    "当前服务器未启用账号开发测试连接。请在测试服务器配置开发模式，正式环境仍需 WSS/HTTPS。",
  account_network_error: "暂时无法连接 Supabase 账号服务，请检查网络后重试。",
  account_invalid_request: "填写内容不符合要求，请检查标红项目后重试。",
  account_secure_storage_unavailable: "Windows 安全存储暂不可用，无法安全保存登录状态。",
  account_guest_not_allowed: "正式环境不允许访客进入，请先登录。",
  account_avatar_invalid: "头像需为 PNG、JPG 或 WebP，且不超过 512 KB。",
  account_avatar_upload_failed: "头像上传失败，请稍后重试。",
  account_profile_unavailable: "账号资料暂时无法读取，请重新登录后再试。",
};

export const accountErrorMessage = (error: unknown): string => {
  const code = typeof error === "string" ? error : accountErrorCode(error);
  return messages[code] ?? "操作没有完成，请稍后重试。";
};
