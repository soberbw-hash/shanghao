import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountAvatarUpdateRequest,
  AccountLoginRequest,
  AccountPasswordResetRequest,
  AccountProfile,
  AccountProfileUpdateRequest,
  AccountRegisterRequest,
  AccountSnapshot,
  RendererLogPayload,
} from "@private-voice/shared";

import { AccountSessionStore, type PersistedAccountSession } from "./account-session-store";

interface AccountApiSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
}

interface AccountAuthResponse {
  profile: AccountProfile;
  session?: AccountApiSession;
  verificationRequired?: boolean;
}

interface AccountErrorBody {
  error?: { code?: string };
}

interface AccountServerStatus {
  configured?: boolean;
  guestAllowed?: boolean;
  secureTransportRequired?: boolean;
  insecureDevelopmentConnection?: boolean;
  auth?: {
    supabaseUrl?: string;
    publishableKey?: string;
    usernameLoginUrl?: string;
  };
}

interface UsernameLoginResponse {
  session?: Session;
  error?: { code?: string };
}

const REFRESH_EARLY_SECONDS = 5 * 60;
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
const SUPABASE_AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

const toPersistedSession = (session: Session): PersistedAccountSession => ({
  accessToken: session.access_token,
  refreshToken: session.refresh_token,
  expiresAt: session.expires_at ?? Math.floor(Date.now() / 1_000) + session.expires_in,
  tokenType: session.token_type,
});

export class AccountDesktopError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "AccountDesktopError";
  }
}

const accountApiBase = (relayServerUrl?: string): URL | undefined => {
  const value = relayServerUrl?.trim();
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return undefined;
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.username = "";
  url.password = "";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
};

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]" ||
  hostname === "::1";

export class AccountDesktopService extends EventEmitter {
  private snapshot: AccountSnapshot = {
    status: "loading",
    configured: false,
    guestAllowed: false,
  };
  private session?: PersistedAccountSession;
  private refreshTimer?: NodeJS.Timeout;
  private supabase?: SupabaseClient;
  private supabasePublishableKey?: string;
  private usernameLoginUrl?: string;
  private developmentConnection = false;

  constructor(
    private readonly sessionStore: AccountSessionStore,
    private readonly getRelayServerUrl: () => string | undefined,
    private readonly fetcher: typeof fetch,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
    private readonly developmentGuestAllowed = false,
  ) {
    super();
  }

  async initialize(): Promise<AccountSnapshot> {
    this.session = await this.sessionStore.read();
    let serverStatus: AccountServerStatus | undefined;
    try {
      serverStatus = await this.request<AccountServerStatus>(
        "/api/account/status",
        { method: "GET" },
        false,
      );
    } catch (error) {
      this.updateSnapshot({
        status: "unavailable",
        configured: false,
        guestAllowed: this.developmentGuestAllowed,
        message: this.codeOf(error),
      });
      return this.getSnapshot();
    }

    const configured = serverStatus.configured === true && this.configureSupabase(serverStatus);
    const guestAllowed = serverStatus.guestAllowed === true;
    this.developmentConnection = serverStatus.insecureDevelopmentConnection === true;
    if (!this.session) {
      this.updateSnapshot({
        status: "signed_out",
        configured,
        guestAllowed,
        developmentConnection: this.developmentConnection,
      });
      return this.getSnapshot();
    }

    try {
      const result = await this.ensureFreshSession(true);
      this.updateSnapshot({
        status: "signed_in",
        configured,
        guestAllowed,
        developmentConnection: this.developmentConnection,
        profile: result.profile,
      });
      return this.getSnapshot();
    } catch (error) {
      await this.clearSession();
      this.updateSnapshot({
        status: "signed_out",
        configured,
        guestAllowed,
        developmentConnection: this.developmentConnection,
        message: this.codeOf(error),
      });
      return this.getSnapshot();
    }
  }

  getSnapshot(): AccountSnapshot {
    return {
      ...this.snapshot,
      profile: this.snapshot.profile ? { ...this.snapshot.profile } : undefined,
    };
  }

  getAccessToken(): string | undefined {
    return this.snapshot.status === "signed_in" ? this.session?.accessToken : undefined;
  }

  async login(input: AccountLoginRequest): Promise<AccountSnapshot> {
    const identifier = input.identifier.trim().toLowerCase();
    if (!identifier || !input.password || input.password.length > 128) {
      throw new AccountDesktopError("account_invalid_credentials");
    }
    const client = this.requireSupabase();
    let session: Session | undefined;
    try {
      if (identifier.includes("@")) {
        const { data, error } = await client.auth.signInWithPassword({
          email: identifier,
          password: input.password,
        });
        if (error || !data.session) throw new AccountDesktopError("account_invalid_credentials");
        session = data.session;
      } else {
        session = await this.loginWithUsername(identifier, input.password);
      }
    } catch (error) {
      if (error instanceof AccountDesktopError) throw error;
      throw new AccountDesktopError("account_network_error", { cause: error });
    }
    await this.acceptSession(toPersistedSession(session));
    const result = await this.ensureFreshSession(true);
    this.updateSnapshot({
      status: "signed_in",
      configured: true,
      guestAllowed: this.snapshot.guestAllowed,
      developmentConnection: this.developmentConnection,
      profile: result.profile,
    });
    await this.log("info", "account login completed", { userId: result.profile.userId });
    return this.getSnapshot();
  }

  async register(input: AccountRegisterRequest): Promise<AccountSnapshot> {
    const username = input.username.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName?.trim() || input.username.trim();
    this.validateRegistration(username, email, input.password, displayName);
    const client = this.requireSupabase();
    let data: Awaited<ReturnType<typeof client.auth.signUp>>["data"];
    let userId: string;
    try {
      const result = await client.auth.signUp({
        email,
        password: input.password,
        options: { data: { username, display_name: displayName } },
      });
      if (result.error || !result.data.user) {
        throw this.registrationError(result.error);
      }
      if (Array.isArray(result.data.user.identities) && result.data.user.identities.length === 0) {
        throw new AccountDesktopError("account_email_taken");
      }
      data = result.data;
      userId = result.data.user.id;
    } catch (error) {
      if (error instanceof AccountDesktopError) throw error;
      throw new AccountDesktopError("account_network_error", { cause: error });
    }
    if (data.session) {
      await this.acceptSession(toPersistedSession(data.session));
      let profile = (await this.ensureFreshSession(true)).profile;
      if (input.avatarDataUrl) {
        profile = await this.authorizedProfileRequest("/api/account/avatar", {
          method: "PUT",
          body: JSON.stringify({ dataUrl: input.avatarDataUrl }),
        });
      }
      this.updateSnapshot({
        status: "signed_in",
        configured: true,
        guestAllowed: this.snapshot.guestAllowed,
        developmentConnection: this.developmentConnection,
        profile,
      });
    } else {
      this.updateSnapshot({
        status: "verification_required",
        configured: true,
        guestAllowed: this.snapshot.guestAllowed,
        developmentConnection: this.developmentConnection,
        profile: {
          userId,
          username,
          displayName,
          email,
        },
        message: "account_email_verification_required",
      });
    }
    await this.log("info", "account registration completed", {
      userId,
      verificationRequired: !data.session,
    });
    return this.getSnapshot();
  }

  async requestPasswordReset(input: AccountPasswordResetRequest): Promise<void> {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new AccountDesktopError("account_email_invalid");
    }
    try {
      const { error } = await this.requireSupabase().auth.resetPasswordForEmail(email);
      if (error) throw error;
    } catch (error) {
      throw new AccountDesktopError("account_network_error", { cause: error });
    }
  }

  async updateProfile(input: AccountProfileUpdateRequest): Promise<AccountSnapshot> {
    const profile = await this.authorizedProfileRequest("/api/account/profile", {
      method: "PUT",
      body: JSON.stringify(input),
    });
    this.updateSnapshot({ ...this.snapshot, status: "signed_in", profile });
    return this.getSnapshot();
  }

  async updateAvatar(input: AccountAvatarUpdateRequest): Promise<AccountSnapshot> {
    const profile = await this.authorizedProfileRequest("/api/account/avatar", {
      method: "PUT",
      body: JSON.stringify(input),
    });
    this.updateSnapshot({ ...this.snapshot, status: "signed_in", profile });
    return this.getSnapshot();
  }

  async logout(): Promise<AccountSnapshot> {
    const current = this.session;
    if (current && this.supabase) {
      try {
        await this.supabase.auth.setSession({
          access_token: current.accessToken,
          refresh_token: current.refreshToken,
        });
        await this.supabase.auth.signOut({ scope: "local" });
      } catch {
        // Local session removal remains authoritative if the network is unavailable.
      }
    }
    await this.clearSession();
    this.updateSnapshot({
      status: "signed_out",
      configured: this.snapshot.configured,
      guestAllowed: this.snapshot.guestAllowed,
      developmentConnection: this.developmentConnection,
    });
    return this.getSnapshot();
  }

  async continueAsGuest(): Promise<AccountSnapshot> {
    if (!this.snapshot.guestAllowed) throw new AccountDesktopError("account_guest_not_allowed");
    await this.clearSession();
    this.updateSnapshot({
      status: "guest",
      configured: this.snapshot.configured,
      guestAllowed: true,
      developmentConnection: this.developmentConnection,
      guestId: `guest:${randomUUID()}`,
    });
    return this.getSnapshot();
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private async authorizedProfileRequest(
    pathname: string,
    init: RequestInit,
  ): Promise<AccountProfile> {
    await this.ensureFreshSession(false);
    const response = await this.request<{ profile: AccountProfile }>(pathname, init, true);
    return response.profile;
  }

  private async ensureFreshSession(forceProfile: boolean): Promise<AccountAuthResponse> {
    if (!this.session) throw new AccountDesktopError("account_session_expired");
    const secondsRemaining = this.session.expiresAt - Math.floor(Date.now() / 1_000);
    if (secondsRemaining <= REFRESH_EARLY_SECONDS) {
      let refreshed: Session | undefined;
      try {
        const { data, error } = await this.requireSupabase().auth.refreshSession({
          refresh_token: this.session.refreshToken,
        });
        if (error || !data.session) throw error;
        refreshed = data.session;
      } catch (error) {
        throw new AccountDesktopError("account_session_expired", { cause: error });
      }
      await this.acceptSession(toPersistedSession(refreshed));
      const profile = (
        await this.request<{ profile: AccountProfile }>("/api/account/me", { method: "GET" }, true)
      ).profile;
      return { profile, session: this.session };
    }
    if (forceProfile) {
      const result = await this.request<{ profile: AccountProfile }>(
        "/api/account/me",
        { method: "GET" },
        true,
      );
      this.scheduleRefresh();
      return { profile: result.profile, session: this.session };
    }
    return { profile: this.snapshot.profile as AccountProfile, session: this.session };
  }

  private async acceptSession(session: AccountApiSession): Promise<void> {
    this.session = { ...session };
    await this.sessionStore.write(this.session);
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (!this.session) return;
    const delay = Math.max(
      30_000,
      (this.session.expiresAt - Math.floor(Date.now() / 1_000) - REFRESH_EARLY_SECONDS) * 1_000,
    );
    this.refreshTimer = setTimeout(() => {
      void this.ensureFreshSession(false)
        .then((result) => {
          if (result.profile) this.updateSnapshot({ ...this.snapshot, profile: result.profile });
        })
        .catch(async (error) => {
          await this.clearSession();
          this.updateSnapshot({
            status: "signed_out",
            configured: this.snapshot.configured,
            guestAllowed: this.snapshot.guestAllowed,
            developmentConnection: this.developmentConnection,
            message: this.codeOf(error),
          });
        });
    }, delay);
    this.refreshTimer.unref?.();
  }

  private async clearSession(): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.session = undefined;
    await this.sessionStore.clear();
  }

  private async request<T>(pathname: string, init: RequestInit, authorized = false): Promise<T> {
    const base = accountApiBase(this.getRelayServerUrl());
    if (!base) throw new AccountDesktopError("account_server_not_configured");
    const isPublicStatusProbe = pathname === "/api/account/status" && init.method === "GET";
    const isAuthorizedDevelopmentRequest = authorized && this.developmentConnection;
    if (
      base.protocol !== "https:" &&
      !isLoopback(base.hostname) &&
      !isPublicStatusProbe &&
      !isAuthorizedDevelopmentRequest
    ) {
      throw new AccountDesktopError("account_secure_transport_required");
    }
    const url = new URL(pathname, base);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json; charset=utf-8");
    if (authorized) {
      const token = this.session?.accessToken;
      if (!token) throw new AccountDesktopError("account_session_expired");
      headers.set("authorization", `Bearer ${token}`);
    }
    let response: Response;
    try {
      response = await this.fetcher(url.toString(), {
        ...init,
        headers,
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new AccountDesktopError("account_server_unreachable", { cause: error });
    }
    if (isPublicStatusProbe && response.status === 404) {
      throw new AccountDesktopError("account_server_upgrade_required");
    }
    let body: T | AccountErrorBody;
    try {
      body = (await response.json()) as T | AccountErrorBody;
    } catch (error) {
      throw new AccountDesktopError(
        isPublicStatusProbe ? "account_not_configured" : "account_server_invalid_response",
        { cause: error },
      );
    }
    if (!response.ok) {
      if (isPublicStatusProbe) throw new AccountDesktopError("account_not_configured");
      const code = (body as AccountErrorBody).error?.code ?? "account_request_failed";
      throw new AccountDesktopError(code);
    }
    return body as T;
  }

  private configureSupabase(status: AccountServerStatus): boolean {
    const supabaseUrl = status.auth?.supabaseUrl?.trim();
    const publishableKey = status.auth?.publishableKey?.trim();
    const usernameLoginUrl = status.auth?.usernameLoginUrl?.trim();
    if (!supabaseUrl || !publishableKey || !usernameLoginUrl) return false;
    try {
      const base = new URL(supabaseUrl);
      const login = new URL(usernameLoginUrl);
      if (
        base.protocol !== "https:" ||
        login.protocol !== "https:" ||
        base.origin !== login.origin ||
        base.username ||
        base.password ||
        login.username ||
        login.password
      ) {
        return false;
      }
      this.supabase = createClient(base.origin, publishableKey, { auth: SUPABASE_AUTH_OPTIONS });
      this.supabasePublishableKey = publishableKey;
      this.usernameLoginUrl = login.toString();
      return true;
    } catch {
      return false;
    }
  }

  private requireSupabase(): SupabaseClient {
    if (!this.supabase) throw new AccountDesktopError("account_not_configured");
    return this.supabase;
  }

  private async loginWithUsername(identifier: string, password: string): Promise<Session> {
    if (!this.usernameLoginUrl || !this.supabasePublishableKey) {
      throw new AccountDesktopError("account_not_configured");
    }
    let response: Response;
    try {
      response = await this.fetcher(this.usernameLoginUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          apikey: this.supabasePublishableKey,
          authorization: `Bearer ${this.supabasePublishableKey}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ identifier, password }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new AccountDesktopError("account_network_error", { cause: error });
    }
    const body = (await response.json().catch(() => ({}))) as UsernameLoginResponse;
    if (!response.ok || !body.session) {
      throw new AccountDesktopError(body.error?.code ?? "account_invalid_credentials");
    }
    return body.session;
  }

  private validateRegistration(
    username: string,
    email: string,
    password: string,
    displayName: string,
  ): void {
    if (!USERNAME_PATTERN.test(username)) throw new AccountDesktopError("account_username_invalid");
    if (RESERVED_USERNAMES.has(username)) {
      throw new AccountDesktopError("account_username_reserved");
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new AccountDesktopError("account_email_invalid");
    }
    if (password.length < 8 || password.length > 128) {
      throw new AccountDesktopError("account_password_weak");
    }
    if (!displayName || Array.from(displayName).length > 32) {
      throw new AccountDesktopError("account_invalid_request");
    }
  }

  private registrationError(error: unknown): AccountDesktopError {
    const detail =
      error && typeof error === "object"
        ? `${"code" in error ? String(error.code) : ""} ${"message" in error ? String(error.message) : ""}`.toLowerCase()
        : "";
    if (detail.includes("username") || detail.includes("database error")) {
      return new AccountDesktopError("account_username_taken");
    }
    if (detail.includes("already") || detail.includes("registered") || detail.includes("exists")) {
      return new AccountDesktopError("account_email_taken");
    }
    return new AccountDesktopError("account_network_error");
  }

  private updateSnapshot(snapshot: AccountSnapshot): void {
    this.snapshot = snapshot;
    this.emit("change", this.getSnapshot());
  }

  private codeOf(error: unknown): string {
    return error instanceof AccountDesktopError || error instanceof Error
      ? error.message
      : "account_request_failed";
  }

  private async log(
    level: RendererLogPayload["level"],
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeLog?.({ category: "app", level, message, context });
  }
}
