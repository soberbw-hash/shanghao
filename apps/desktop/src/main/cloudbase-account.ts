import cloudbase from "@cloudbase/js-sdk";

import type { AccountProfile } from "@private-voice/shared";

import { isValidCloudBaseUsername } from "../common/cloudbase-username";

import type { PersistedAccountSession } from "./account-session-store";
import { AccountDesktopError } from "./account-errors";

type CloudBaseApp = ReturnType<typeof cloudbase.init>;
type CloudBaseAuth = ReturnType<CloudBaseApp["auth"]>;
export type CloudBaseAccountAuth = Pick<
  CloudBaseAuth,
  | "getVerification"
  | "verify"
  | "signIn"
  | "signUp"
  | "setCredentials"
  | "refreshTokenForce"
  | "getCurrentUser"
  | "getCredentials"
  | "signOut"
>;

export interface CloudBaseAccountDiagnostic {
  stage: string;
  code: string;
  providerCode?: string;
  requestId?: string;
}

interface CloudBaseAccountDependencies {
  auth?: CloudBaseAccountAuth;
  onDiagnostic?: (diagnostic: CloudBaseAccountDiagnostic) => void;
}

interface CloudBaseCredentials {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  expires_at?: Date | null;
  token_type?: string | null;
}

interface CloudBaseUser {
  uid?: string;
  sub?: string;
  username?: string;
  name?: string;
  displayName?: string;
  nickName?: string;
  email?: string;
  phone_number?: string;
  phoneNumber?: string;
  picture?: string;
  user_metadata?: {
    username?: string;
    name?: string;
    displayName?: string;
    nickName?: string;
    phone_number?: string;
    picture?: string;
  };
  update?: (userinfo: { name?: string; nickName?: string }) => Promise<void>;
}

export interface CloudBaseAccountOptions {
  envId: string;
  region: string;
  publishableKey: string;
}

export interface CloudBaseVerification {
  phoneNumber: string;
  verificationId: string;
  isUser: boolean;
}

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "system",
  "support",
  "official",
  "shanghao",
]);

/**
 * CloudBase v3 keeps the v2-compatible auth methods, but some of those methods
 * return an AuthResult instead of throwing for an auth-level failure. Convert
 * both forms into one exception path so a failed signup cannot fall through to
 * the misleading "session expired" message.
 */
const assertCloudBaseAuthSuccess = (result: unknown): void => {
  if (!result || typeof result !== "object") return;
  const error = (result as { error?: unknown }).error;
  // OAuth errors can put the description beside the string error code. Keep
  // that envelope so classification does not lose which argument was rejected.
  if (error) throw typeof error === "string" ? result : error;
};

export const normalizeCloudBasePhone = (input: string): string => {
  const compact = input.trim().replace(/[\s()-]/g, "");
  // CloudBase Auth expects Chinese numbers in the documented `+86 1xxxxxxxxxx`
  // form when they are sent through signIn({ username, password }). Keep one
  // canonical representation for verification, signup, and password login.
  if (/^1\d{10}$/.test(compact)) return `+86 ${compact}`;
  if (!PHONE_PATTERN.test(compact)) {
    throw new AccountDesktopError("account_phone_invalid");
  }
  return compact.startsWith("+86") ? `+86 ${compact.slice(3)}` : compact;
};

export class CloudBaseAccountClient {
  private readonly auth: CloudBaseAccountAuth;
  private verification?: CloudBaseVerification;

  constructor(
    options: CloudBaseAccountOptions,
    private readonly dependencies: CloudBaseAccountDependencies = {},
  ) {
    if (!options.envId.trim() || !options.region.trim() || !options.publishableKey.trim()) {
      throw new AccountDesktopError("account_not_configured");
    }
    this.auth =
      dependencies.auth ??
      cloudbase
        .init({
          env: options.envId.trim(),
          region: options.region.trim(),
          accessKey: options.publishableKey.trim(),
          timeout: 15_000,
          persistence: "none",
        })
        .auth({ persistence: "none" });
  }

  async requestVerificationCode(phoneInput: string): Promise<void> {
    const phoneNumber = normalizeCloudBasePhone(phoneInput);
    try {
      const result = await this.auth.getVerification({ phone_number: phoneNumber });
      assertCloudBaseAuthSuccess(result);
      const verificationId = result.verification_id?.trim();
      if (!verificationId) throw new Error("verification_id_missing");
      this.verification = {
        phoneNumber,
        verificationId,
        isUser: result.is_user === true,
      };
    } catch (error) {
      throw this.mapError(error, "account_verification_send_failed", "send_code");
    }
  }

  async registerByPhone(input: {
    phone: string;
    verificationCode: string;
    username: string;
    password: string;
    displayName: string;
  }): Promise<{ profile: AccountProfile; session: PersistedAccountSession }> {
    const phoneNumber = normalizeCloudBasePhone(input.phone);
    const username = input.username.trim();
    const displayName = input.displayName.trim();
    if (!isValidCloudBaseUsername(username)) {
      throw new AccountDesktopError("account_username_invalid");
    }
    if (RESERVED_USERNAMES.has(username.toLowerCase())) {
      throw new AccountDesktopError("account_username_reserved");
    }
    if (!/^\d{6}$/.test(input.verificationCode.trim())) {
      throw new AccountDesktopError("account_verification_invalid");
    }
    if (
      input.password.length < 8 ||
      input.password.length > 32 ||
      !/[a-z]/i.test(input.password) ||
      !/\d/.test(input.password)
    ) {
      throw new AccountDesktopError("account_password_weak");
    }
    if (!displayName || Array.from(displayName).length > 32) {
      throw new AccountDesktopError("account_invalid_request");
    }
    if (!this.verification || this.verification.phoneNumber !== phoneNumber) {
      throw new AccountDesktopError("account_verification_expired");
    }

    let stage = "verify_code";
    try {
      const verified = await this.auth.verify({
        verification_id: this.verification.verificationId,
        verification_code: input.verificationCode.trim(),
      });
      assertCloudBaseAuthSuccess(verified);
      const verificationToken = verified.verification_token?.trim();
      if (!verificationToken) throw new Error("verification_token_missing");

      if (this.verification.isUser) {
        stage = "sign_in_verified_phone";
        const loginResult = await this.auth.signIn({
          username: phoneNumber,
          verification_token: verificationToken,
        });
        assertCloudBaseAuthSuccess(loginResult);
      } else {
        stage = "sign_up";
        const registrationResult = await this.auth.signUp({
          phone_number: phoneNumber,
          verification_code: input.verificationCode.trim(),
          verification_token: verificationToken,
          username,
          password: input.password,
          name: displayName,
        });
        assertCloudBaseAuthSuccess(registrationResult);
      }
      this.verification = undefined;
      stage = "read_registered_account";
      return await this.readAuthenticatedAccount();
    } catch (error) {
      throw this.mapError(error, "account_registration_failed", stage);
    }
  }

  async login(
    identifierInput: string,
    password: string,
  ): Promise<{
    profile: AccountProfile;
    session: PersistedAccountSession;
  }> {
    const identifier = identifierInput.trim();
    if (!identifier || !password || password.length > 128) {
      throw new AccountDesktopError("account_invalid_credentials");
    }
    const username = /^1\d{10}$/.test(identifier)
      ? normalizeCloudBasePhone(identifier)
      : identifier;
    try {
      const loginResult = await this.auth.signIn({ username, password });
      assertCloudBaseAuthSuccess(loginResult);
      return await this.readAuthenticatedAccount();
    } catch (error) {
      throw this.mapError(error, "account_login_unavailable", "password_login");
    }
  }

  async restore(session: PersistedAccountSession): Promise<{
    profile: AccountProfile;
    session: PersistedAccountSession;
  }> {
    try {
      await this.auth.setCredentials({
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_at: new Date(session.expiresAt * 1_000),
        token_type: session.tokenType,
      });
      return await this.readAuthenticatedAccount();
    } catch (error) {
      throw this.mapError(error, "account_session_expired");
    }
  }

  async refresh(): Promise<{ profile: AccountProfile; session: PersistedAccountSession }> {
    try {
      await this.auth.refreshTokenForce({});
      return await this.readAuthenticatedAccount();
    } catch (error) {
      throw this.mapError(error, "account_session_expired");
    }
  }

  async updateProfile(displayName: string): Promise<AccountProfile> {
    const user = await this.requireUser();
    const value = displayName.trim();
    if (!value || Array.from(value).length > 32) {
      throw new AccountDesktopError("account_invalid_request");
    }
    try {
      if (!user.update) throw new Error("account_profile_update_unsupported");
      await user.update({ name: value });
      return this.toProfile(await this.requireUser());
    } catch (error) {
      throw this.mapError(error, "account_profile_unavailable");
    }
  }

  async getProfile(): Promise<AccountProfile> {
    return this.toProfile(await this.requireUser());
  }

  async getSession(): Promise<PersistedAccountSession> {
    return this.toSession(await this.auth.getCredentials());
  }

  async signOut(): Promise<void> {
    await this.auth.signOut().catch(() => undefined);
    this.verification = undefined;
  }

  private async readAuthenticatedAccount(): Promise<{
    profile: AccountProfile;
    session: PersistedAccountSession;
  }> {
    const user = await this.requireUser();
    return { profile: this.toProfile(user), session: await this.getSession() };
  }

  private async requireUser(): Promise<CloudBaseUser> {
    const user = await this.auth.getCurrentUser();
    if (!user) throw new AccountDesktopError("account_session_expired");
    return user as CloudBaseUser;
  }

  private toSession(credentials: CloudBaseCredentials): PersistedAccountSession {
    const accessToken = credentials.access_token?.trim();
    const refreshToken = credentials.refresh_token?.trim();
    if (!accessToken || !refreshToken) {
      throw new AccountDesktopError("account_session_expired");
    }
    const expiresAt =
      credentials.expires_at instanceof Date
        ? Math.floor(credentials.expires_at.getTime() / 1_000)
        : Math.floor(Date.now() / 1_000) + Math.max(60, credentials.expires_in ?? 7_200);
    return {
      accessToken,
      refreshToken,
      expiresAt,
      tokenType: credentials.token_type?.trim() || "Bearer",
      provider: "cloudbase",
    };
  }

  private toProfile(user: CloudBaseUser): AccountProfile {
    const metadata = user.user_metadata;
    const userId = user.uid?.trim() || user.sub?.trim();
    if (!userId) throw new AccountDesktopError("account_profile_unavailable");
    const username =
      user.username?.trim() ||
      metadata?.username?.trim() ||
      user.phoneNumber?.trim() ||
      user.phone_number?.trim() ||
      metadata?.phone_number?.trim() ||
      user.email?.trim() ||
      userId;
    return {
      userId,
      username,
      displayName:
        user.name?.trim() ||
        user.displayName?.trim() ||
        user.nickName?.trim() ||
        metadata?.name?.trim() ||
        metadata?.displayName?.trim() ||
        metadata?.nickName?.trim() ||
        username,
      email: user.email?.trim() || undefined,
      avatarUrl: user.picture?.trim() || metadata?.picture?.trim() || undefined,
    };
  }
  private mapError(error: unknown, fallback: string, stage = "session"): AccountDesktopError {
    const fields = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
    // Auth v2 can reject with { error, error_description }, not an Error instance.
    // Inspect descriptions for classification only: they can contain personal data.
    const detail = [
      fields.error,
      fields.code,
      fields.error_code,
      fields.errorCode,
      fields.category,
      fields.error_description,
      fields.message,
      typeof error === "string" ? error : undefined,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    let code = fallback;
    if (error instanceof AccountDesktopError) code = error.code;
    else if (
      /network|fetch failed|failed to fetch|econn|enotfound|etimedout|timeout/.test(detail)
    ) {
      code = /verification|otp/.test(detail)
        ? "account_verification_expired"
        : "account_network_error";
    } else if (/resource_exhausted|rate.limit|too.many|too.frequent/.test(detail)) {
      code = stage === "send_code" ? "account_verification_rate_limited" : "account_rate_limited";
    } else if (/captcha/.test(detail)) code = "account_verification_challenge_required";
    else if (
      /permission_denied|provider_not_enabled|login_method_disabled|invalid_client|invalid_api_key|unauthorized_client|service_error|server_error|temporarily_unavailable/.test(
        detail,
      )
    ) {
      code = "account_login_unavailable";
    } else if (
      /invalid_username_or_password|invalid_credentials|wrong_password|user_not_found/.test(detail)
    ) {
      code = "account_invalid_credentials";
    } else if (/verification|otp/.test(detail) && !/missing/.test(detail)) {
      code = /expired/.test(detail)
        ? "account_verification_expired"
        : "account_verification_invalid";
    } else if (/username/.test(detail) && /exist|taken|duplicate|already/.test(detail)) {
      code = "account_username_taken";
    } else if (/username/.test(detail) && /invalid|format/.test(detail)) {
      code = "account_username_invalid";
    } else if (/phone/.test(detail) && /invalid|format/.test(detail)) {
      code = "account_phone_invalid";
    } else if (/password/.test(detail) && /weak|length|policy|invalid|require/.test(detail)) {
      code = "account_password_weak";
    } else if (/invalid_argument|invalid_request/.test(detail)) code = "account_invalid_request";

    const safeField = (value: unknown) =>
      typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(value) ? value : undefined;
    const requestId = fields.request_id ?? fields.requestId;
    try {
      this.dependencies.onDiagnostic?.({
        stage,
        code,
        providerCode: safeField(fields.error ?? fields.code ?? fields.error_code),
        requestId:
          typeof requestId === "string" && /^[a-f0-9-]{16,64}$/i.test(requestId)
            ? requestId
            : undefined,
      });
    } catch {
      /* Diagnostics must never replace the original account failure. */
    }
    return error instanceof AccountDesktopError
      ? error
      : new AccountDesktopError(code, { cause: error });
  }
}
