import type { AccountPasswordResetRequest } from "@private-voice/shared";

export const validatePasswordResetRequest = (
  request: AccountPasswordResetRequest,
): AccountPasswordResetRequest => {
  const text = (value: unknown, maximum: number, label: string): string => {
    if (typeof value !== "string" || value.length > maximum) {
      throw new Error(`invalid_${label}`);
    }
    return value;
  };
  return {
    email: text(request?.email, 254, "account_email"),
    verificationCode:
      request?.verificationCode === undefined
        ? undefined
        : text(request.verificationCode, 6, "account_verification"),
    newPassword:
      request?.newPassword === undefined
        ? undefined
        : text(request.newPassword, 32, "account_password"),
  };
};
