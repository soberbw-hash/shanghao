import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AccountProfile } from "@private-voice/shared";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,19}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "system",
  "support",
  "official",
  "shanghao",
]);
const MAX_AVATAR_BYTES = 512 * 1024;

export type AccountServerErrorCode =
  | "account_not_configured"
  | "account_invalid_request"
  | "account_username_invalid"
  | "account_username_reserved"
  | "account_username_taken"
  | "account_email_invalid"
  | "account_email_taken"
  | "account_password_weak"
  | "account_invalid_credentials"
  | "account_session_expired"
  | "account_profile_unavailable"
  | "account_avatar_invalid"
  | "account_avatar_upload_failed"
  | "account_network_error";

export class AccountServerError extends Error {
  constructor(
    readonly code: AccountServerErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "AccountServerError";
  }
}

export interface AccountServerSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
}

export interface AccountAuthResult {
  profile: AccountProfile;
  session?: AccountServerSession;
  verificationRequired?: boolean;
}

export interface VerifiedAccountIdentity {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

export interface AccountBackend {
  readonly configured: boolean;
  readonly publicConfiguration?: {
    supabaseUrl: string;
    publishableKey: string;
    usernameLoginUrl: string;
  };
  register(input: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
  }): Promise<AccountAuthResult>;
  login(identifier: string, password: string): Promise<AccountAuthResult>;
  refresh(refreshToken: string): Promise<AccountAuthResult>;
  requestPasswordReset(email: string): Promise<void>;
  getProfile(accessToken: string): Promise<AccountProfile>;
  updateProfile(accessToken: string, displayName: string): Promise<AccountProfile>;
  updateAvatar(accessToken: string, dataUrl: string): Promise<AccountProfile>;
  verifyAccessToken(accessToken: string): Promise<VerifiedAccountIdentity>;
}

interface ProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
}

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

const toProfile = (row: ProfileRow, email?: string): AccountProfile => ({
  userId: row.id,
  username: row.username,
  displayName: row.display_name,
  email,
  avatarUrl: row.avatar_url ?? undefined,
});

const toSession = (session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in: number;
  token_type: string;
}): AccountServerSession => ({
  accessToken: session.access_token,
  refreshToken: session.refresh_token,
  expiresAt: session.expires_at ?? Math.floor(Date.now() / 1_000) + session.expires_in,
  tokenType: session.token_type,
});

const parseAvatar = (
  dataUrl: string,
): { bytes: Uint8Array; contentType: string; extension: string } => {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new AccountServerError("account_avatar_invalid");
  const contentType = match[1];
  const encoded = match[2];
  if (!contentType || !encoded) throw new AccountServerError("account_avatar_invalid");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_AVATAR_BYTES) {
    throw new AccountServerError("account_avatar_invalid");
  }
  const validSignature =
    (contentType === "image/png" &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (contentType === "image/jpeg" &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff) ||
    (contentType === "image/webp" &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP");
  if (!validSignature) throw new AccountServerError("account_avatar_invalid");
  return {
    bytes: buffer,
    contentType,
    extension: contentType === "image/jpeg" ? "jpg" : contentType.slice("image/".length),
  };
};

export class SupabaseAccountService implements AccountBackend {
  readonly configured: boolean;
  readonly publicConfiguration?: AccountBackend["publicConfiguration"];
  private readonly admin?: SupabaseClient;
  private readonly publicClient?: SupabaseClient;

  constructor(
    private readonly options: {
      supabaseUrl?: string;
      publishableKey?: string;
      secretKey?: string;
      passwordResetRedirectUrl?: string;
      logger?: (message: string, context?: Record<string, unknown>) => void;
    },
  ) {
    const supabaseUrl = options.supabaseUrl?.trim();
    const publishableKey = options.publishableKey?.trim();
    const secretKey = options.secretKey?.trim();
    this.configured = false;
    if (!supabaseUrl || !publishableKey || !secretKey) return;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(supabaseUrl);
    } catch {
      return;
    }
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) return;
    this.configured = true;
    this.publicConfiguration = {
      supabaseUrl: parsedUrl.origin,
      publishableKey,
      usernameLoginUrl: `${parsedUrl.origin}/functions/v1/shanghao-username-login`,
    };

    this.publicClient = createClient(parsedUrl.origin, publishableKey, { auth: authOptions });
    this.admin = createClient(parsedUrl.origin, secretKey, { auth: authOptions });
  }

  static fromEnvironment(
    logger?: (message: string, context?: Record<string, unknown>) => void,
  ): SupabaseAccountService {
    return new SupabaseAccountService({
      supabaseUrl: process.env.SUPABASE_URL,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
      secretKey: process.env.SUPABASE_SECRET_KEY,
      passwordResetRedirectUrl: process.env.SUPABASE_PASSWORD_RESET_REDIRECT_URL,
      logger,
    });
  }

  async register(input: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
  }): Promise<AccountAuthResult> {
    const client = this.requirePublicClient();
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName?.trim() || input.username.trim();
    this.validateRegistration(username, email, input.password, displayName);

    const existingEmail = await this.resolveLoginEmail(username);
    if (existingEmail) throw new AccountServerError("account_username_taken");

    const { data, error } = await client.auth.signUp({
      email,
      password: input.password,
      options: { data: { username, display_name: displayName } },
    });
    if (error || !data.user) {
      this.logFailure("account registration rejected", error);
      const detail = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
      if (detail.includes("username") || detail.includes("database error")) {
        throw new AccountServerError("account_username_taken", { cause: error });
      }
      if (
        detail.includes("already") ||
        detail.includes("registered") ||
        detail.includes("exists")
      ) {
        throw new AccountServerError("account_email_taken", { cause: error });
      }
      throw new AccountServerError("account_network_error", { cause: error });
    }
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new AccountServerError("account_email_taken");
    }

    const profile = await this.readProfile(data.user.id, email);
    return {
      profile,
      session: data.session ? toSession(data.session) : undefined,
      verificationRequired: !data.session,
    };
  }

  async login(identifier: string, password: string): Promise<AccountAuthResult> {
    const client = this.requirePublicClient();
    const normalizedIdentifier = identifier.trim().toLowerCase();
    if (!normalizedIdentifier || !password || password.length > 128) {
      throw new AccountServerError("account_invalid_credentials");
    }
    const email = normalizedIdentifier.includes("@")
      ? normalizedIdentifier
      : await this.resolveLoginEmail(normalizedIdentifier);
    if (!email) throw new AccountServerError("account_invalid_credentials");

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      this.logFailure("account login rejected", error);
      throw new AccountServerError("account_invalid_credentials", { cause: error });
    }
    return {
      profile: await this.readProfile(data.user.id, data.user.email),
      session: toSession(data.session),
    };
  }

  async refresh(refreshToken: string): Promise<AccountAuthResult> {
    const client = this.requirePublicClient();
    if (!refreshToken || refreshToken.length > 4_096) {
      throw new AccountServerError("account_session_expired");
    }
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || !data.user) {
      this.logFailure("account session refresh rejected", error);
      throw new AccountServerError("account_session_expired", { cause: error });
    }
    return {
      profile: await this.readProfile(data.user.id, data.user.email),
      session: toSession(data.session),
    };
  }

  async requestPasswordReset(emailInput: string): Promise<void> {
    const client = this.requirePublicClient();
    const email = emailInput.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new AccountServerError("account_email_invalid");
    }
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: this.options.passwordResetRedirectUrl,
    });
    if (error) {
      this.logFailure("account password reset request failed", error);
      throw new AccountServerError("account_network_error", { cause: error });
    }
  }

  async getProfile(accessToken: string): Promise<AccountProfile> {
    const user = await this.readUser(accessToken);
    return this.readProfile(user.id, user.email);
  }

  async updateProfile(accessToken: string, displayNameInput: string): Promise<AccountProfile> {
    const admin = this.requireAdmin();
    const user = await this.readUser(accessToken);
    const displayName = displayNameInput.trim();
    if (!displayName || Array.from(displayName).length > 32) {
      throw new AccountServerError("account_invalid_request");
    }
    const { data, error } = await admin
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", user.id)
      .select("id, username, display_name, avatar_url")
      .single<ProfileRow>();
    if (error || !data) {
      this.logFailure("account profile update failed", error);
      throw new AccountServerError("account_profile_unavailable", { cause: error });
    }
    return toProfile(data, user.email);
  }

  async updateAvatar(accessToken: string, dataUrl: string): Promise<AccountProfile> {
    const admin = this.requireAdmin();
    const user = await this.readUser(accessToken);
    const avatar = parseAvatar(dataUrl);
    const objectPath = `${user.id}/avatar.${avatar.extension}`;
    const { error: uploadError } = await admin.storage
      .from("avatars")
      .upload(objectPath, avatar.bytes, {
        upsert: true,
        cacheControl: "3600",
        contentType: avatar.contentType,
      });
    if (uploadError) {
      this.logFailure("account avatar upload failed", uploadError);
      throw new AccountServerError("account_avatar_upload_failed", { cause: uploadError });
    }
    const { data: publicUrl } = admin.storage.from("avatars").getPublicUrl(objectPath);
    const avatarUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
    const { data, error } = await admin
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", user.id)
      .select("id, username, display_name, avatar_url")
      .single<ProfileRow>();
    if (error || !data) {
      this.logFailure("account avatar profile update failed", error);
      throw new AccountServerError("account_avatar_upload_failed", { cause: error });
    }
    return toProfile(data, user.email);
  }

  async verifyAccessToken(accessToken: string): Promise<VerifiedAccountIdentity> {
    const profile = await this.getProfile(accessToken);
    return {
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    };
  }

  private validateRegistration(
    username: string,
    email: string,
    password: string,
    displayName: string,
  ): void {
    if (!USERNAME_PATTERN.test(username)) {
      throw new AccountServerError("account_username_invalid");
    }
    if (RESERVED_USERNAMES.has(username)) {
      throw new AccountServerError("account_username_reserved");
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new AccountServerError("account_email_invalid");
    }
    if (password.length < 8 || password.length > 128) {
      throw new AccountServerError("account_password_weak");
    }
    if (!displayName || Array.from(displayName).length > 32) {
      throw new AccountServerError("account_invalid_request");
    }
  }

  private async resolveLoginEmail(identifier: string): Promise<string | undefined> {
    const admin = this.requireAdmin();
    const { data, error } = await admin.rpc("resolve_account_email", {
      input_identifier: identifier,
    });
    if (error) {
      this.logFailure("account identifier resolution failed", error);
      throw new AccountServerError("account_network_error", { cause: error });
    }
    return typeof data === "string" && data ? data : undefined;
  }

  private async readUser(accessToken: string): Promise<{ id: string; email?: string }> {
    const admin = this.requireAdmin();
    if (!accessToken || accessToken.length > 8_192) {
      throw new AccountServerError("account_session_expired");
    }
    const { data, error } = await admin.auth.getUser(accessToken);
    if (error || !data.user) {
      this.logFailure("account access token rejected", error);
      throw new AccountServerError("account_session_expired", { cause: error });
    }
    return { id: data.user.id, email: data.user.email };
  }

  private async readProfile(userId: string, email?: string): Promise<AccountProfile> {
    const admin = this.requireAdmin();
    const { data, error } = await admin
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .eq("id", userId)
      .single<ProfileRow>();
    if (error || !data) {
      this.logFailure("account profile read failed", error);
      throw new AccountServerError("account_profile_unavailable", { cause: error });
    }
    return toProfile(data, email);
  }

  private requireAdmin(): SupabaseClient {
    if (!this.admin) throw new AccountServerError("account_not_configured");
    return this.admin;
  }

  private requirePublicClient(): SupabaseClient {
    if (!this.publicClient) throw new AccountServerError("account_not_configured");
    return this.publicClient;
  }

  private logFailure(message: string, error: unknown): void {
    this.options.logger?.(message, {
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "unknown",
      status:
        error && typeof error === "object" && "status" in error
          ? Number((error as { status?: unknown }).status) || undefined
          : undefined,
    });
  }
}
