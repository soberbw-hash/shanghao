import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AccountAvatarUpdateRequest,
  CloudBaseClientConfig,
  AccountLoginRequest,
  AccountRememberedLogin,
  AccountPasswordResetRequest,
  AccountProfile,
  AccountProfileUpdateRequest,
  AccountRegisterRequest,
  AccountSnapshot,
  RendererLogPayload,
} from "@private-voice/shared";

import { AccountSessionStore, type PersistedAccountSession } from "./account-session-store";
import { CloudBaseAccountClient } from "./cloudbase-account";
import { isDeepLinkAuthCallback, SHANGHAO_AUTH_REDIRECT_URL } from "./deep-link";
import { AccountDesktopError } from "./account-errors";

export { AccountDesktopError } from "./account-errors";

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
    provider?: "supabase" | "cloudbase";
    supabaseUrl?: string;
    publishableKey?: string;
    usernameLoginUrl?: string;
    cloudbaseEnvId?: string;
    cloudbaseRegion?: string;
    cloudbasePublishableKey?: string;
  };
}

interface UsernameLoginResponse {
  session?: unknown;
  error?: { code?: string };
}

const REFRESH_EARLY_SECONDS = 5 * 60;
// Legacy/Supabase fallback only. CloudBase validates its own signup rules in
// CloudBaseAccountClient; changing this expression cannot fix CloudBase signup.
const USERNAME_ALLOWED_CHARACTER = /^[a-z0-9_-]$/i;
const USERNAME_EDGE_CHARACTER = /^[a-z0-9]$/i;
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
  provider: "supabase",
});

const isUsableSession = (value: unknown): value is Session => {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  return (
    typeof session.access_token === "string" &&
    Boolean(session.access_token) &&
    typeof session.refresh_token === "string" &&
    Boolean(session.refresh_token) &&
    typeof session.expires_in === "number" &&
    typeof session.token_type === "string"
  );
};

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
  private cloudbase?: CloudBaseAccountClient;
  private localCloudbaseConfig?: CloudBaseClientConfig;
  private accountProvider: "supabase" | "cloudbase" = "supabase";
  /** Session persistence is opt-out from the login form, never password persistence. */
  private rememberSession = true;
  private supabaseUrl?: string;
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
    // A restored session necessarily came from the remembered-session store;
    // a fresh login should also default to remember-me until the user opts out.
    this.rememberSession = true;
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

    // The renderer injects the current CloudBase client configuration from its
    // local Vite environment. Keep that explicit local configuration as the
    // source of truth; an older Relay status must not replace it during
    // hydration with stale server-side auth settings.
    const configured = this.localCloudbaseConfig
      ? this.cloudbase !== undefined
      : serverStatus.configured === true && this.configureProvider(serverStatus);
    const guestAllowed = serverStatus.guestAllowed === true;
    this.developmentConnection = serverStatus.insecureDevelopmentConnection === true;
    // In development, the renderer provides the CloudBase client config after
    // the main process has started. Do not interpret that short window as a
    // provider mismatch and delete a valid persisted CloudBase session.
    const providerConfigured = Boolean(
      this.localCloudbaseConfig || this.cloudbase || this.supabase,
    );
    if (
      this.session &&
      providerConfigured &&
      this.accountProvider !== (this.session.provider ?? "supabase")
    ) {
      await this.clearSession();
    }
    if (this.session && !providerConfigured) {
      this.updateSnapshot({
        status: "loading",
        configured: false,
        guestAllowed,
        developmentConnection: this.developmentConnection,
      });
      return this.getSnapshot();
    }
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

  async configureCloudBase(config: CloudBaseClientConfig): Promise<void> {
    const envId = config.envId.trim();
    const region = config.region.trim();
    const publishableKey = config.publishableKey.trim();
    if (!envId || !region || !publishableKey) {
      throw new AccountDesktopError("account_not_configured");
    }
    const persistedProvider = this.session?.provider ?? this.accountProvider;
    if (persistedProvider !== "cloudbase" && this.session) {
      await this.clearSession();
    }
    this.accountProvider = "cloudbase";
    this.supabase = undefined;
    this.supabaseUrl = undefined;
    this.supabasePublishableKey = undefined;
    this.usernameLoginUrl = undefined;
    const localConfig = { envId, region, publishableKey };
    this.cloudbase = new CloudBaseAccountClient(localConfig, {
      onDiagnostic: (diagnostic) => {
        void this.log("warn", "CloudBase account request failed", { ...diagnostic }).catch(
          () => undefined,
        );
      },
    });
    this.localCloudbaseConfig = localConfig;
    this.updateSnapshot({ ...this.snapshot, configured: true });

    // The main process may have deferred session hydration until this local
    // CloudBase config arrived. Finish that hydration here so the renderer
    // never has to ask the user for a password again after a restart.
    if (this.session && this.snapshot.status !== "signed_in") {
      try {
        const result = await this.ensureFreshSession(true);
        this.updateSnapshot({
          status: "signed_in",
          configured: true,
          guestAllowed: this.snapshot.guestAllowed,
          developmentConnection: this.developmentConnection,
          profile: result.profile,
        });
      } catch (error) {
        await this.clearSession();
        this.updateSnapshot({
          status: "signed_out",
          configured: true,
          guestAllowed: this.snapshot.guestAllowed,
          developmentConnection: this.developmentConnection,
          message: this.codeOf(error),
        });
      }
    }
  }

  getAccessToken(): string | undefined {
    return this.snapshot.status === "signed_in" ? this.session?.accessToken : undefined;
  }

  /**
   * Relay connections must not reuse an access token that is about to expire.
   * Keep this behind the main-process account service so there is still one
   * authoritative session/token source for the whole desktop app.
   */
  async getFreshAccessToken(): Promise<string | undefined> {
    if (this.snapshot.status !== "signed_in" || !this.session) return undefined;
    await this.ensureFreshSession(false);
    return this.session?.accessToken;
  }

  async getRememberedLogin(): Promise<AccountRememberedLogin | undefined> {
    return this.sessionStore.readRememberedLogin();
  }

  async login(input: AccountLoginRequest): Promise<AccountSnapshot> {
    this.rememberSession = input.rememberMe !== false;
    const identifier =
      this.accountProvider === "cloudbase"
        ? input.identifier.trim()
        : input.identifier.trim().toLowerCase();
    if (!identifier || !input.password || input.password.length > 128) {
      throw new AccountDesktopError("account_invalid_credentials");
    }
    if (this.accountProvider === "cloudbase") {
      const result = await this.requireCloudBase().login(identifier, input.password);
      await this.acceptSession(result.session);
      this.updateSnapshot({
        status: "signed_in",
        configured: true,
        guestAllowed: this.snapshot.guestAllowed,
        developmentConnection: this.developmentConnection,
        profile: result.profile,
      });
      await this.persistRememberedLogin(identifier, input.password);
      await this.log("info", "account login completed", { userId: result.profile.userId });
      return this.getSnapshot();
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
    await this.persistRememberedLogin(identifier, input.password);
    await this.log("info", "account login completed", { userId: result.profile.userId });
    return this.getSnapshot();
  }

  async register(input: AccountRegisterRequest): Promise<AccountSnapshot> {
    // Registration is a successful sign-in flow too; keep the normal desktop
    // behavior even though the registration form does not ask about it again.
    this.rememberSession = true;
    const username =
      this.accountProvider === "cloudbase"
        ? input.username.trim()
        : input.username.trim().toLowerCase();
    const email = input.email?.trim().toLowerCase() ?? "";
    const displayName = input.displayName?.trim() || input.username.trim();
    if (this.accountProvider === "cloudbase") {
      if (!input.phone || !input.verificationCode) {
        throw new AccountDesktopError("account_verification_invalid");
      }
      const result = await this.requireCloudBase().registerByPhone({
        phone: input.phone,
        verificationCode: input.verificationCode,
        username,
        password: input.password,
        displayName,
      });
      await this.acceptSession(result.session);
      this.updateSnapshot({
        status: "signed_in",
        configured: true,
        guestAllowed: this.snapshot.guestAllowed,
        developmentConnection: this.developmentConnection,
        profile: result.profile,
      });
      await this.sessionStore.writeRememberedLogin({
        identifier: username,
        password: input.password,
      });
      await this.log("info", "account registration completed", {
        userId: result.profile.userId,
        verificationRequired: false,
      });
      return this.getSnapshot();
    }
    this.validateRegistration(username, email, input.password, displayName);
    const client = this.requireSupabase();
    let data: Awaited<ReturnType<typeof client.auth.signUp>>["data"];
    let userId: string;
    try {
      const result = await client.auth.signUp({
        email,
        password: input.password,
        options: {
          data: { username, display_name: displayName },
          emailRedirectTo: SHANGHAO_AUTH_REDIRECT_URL,
        },
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
      await this.sessionStore.writeRememberedLogin({
        identifier: username,
        password: input.password,
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

  async handleAuthDeepLink(rawUrl: string): Promise<AccountSnapshot> {
    if (!isDeepLinkAuthCallback(rawUrl)) return this.getSnapshot();

    if (this.snapshot.message === "account_email_verified") {
      return this.getSnapshot();
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return this.setAuthCallbackMessage("account_email_verification_failed");
    }

    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    for (const [key, value] of url.searchParams) params.set(key, value);
    const callbackError = params.get("error_code") ?? params.get("error");
    if (callbackError) {
      return this.setAuthCallbackMessage(this.authCallbackErrorCode(callbackError));
    }

    const code = params.get("code");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!code && (!accessToken || !refreshToken)) {
      return this.setAuthCallbackMessage("account_email_verification_failed");
    }

    try {
      if (!this.supabaseUrl || !this.supabasePublishableKey) {
        throw new AccountDesktopError("account_not_configured");
      }
      const callbackClient = createClient(this.supabaseUrl, this.supabasePublishableKey, {
        auth: SUPABASE_AUTH_OPTIONS,
      });
      const result = code
        ? await callbackClient.auth.exchangeCodeForSession(code)
        : await callbackClient.auth.setSession({
            access_token: accessToken as string,
            refresh_token: refreshToken as string,
          });
      if (result.error || !isUsableSession(result.data.session)) {
        return this.setAuthCallbackMessage(this.authCallbackErrorCode(result.error));
      }
      await callbackClient.auth.signOut({ scope: "local" }).catch(() => undefined);
      return this.setAuthCallbackMessage("account_email_verified");
    } catch (error) {
      return this.setAuthCallbackMessage(this.authCallbackErrorCode(error));
    }
  }

  async requestPasswordReset(input: AccountPasswordResetRequest): Promise<void> {
    if (this.accountProvider === "cloudbase") {
      throw new AccountDesktopError("account_not_supported");
    }
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

  async requestVerificationCode(phone: string): Promise<void> {
    if (this.accountProvider !== "cloudbase") {
      throw new AccountDesktopError("account_not_configured");
    }
    await this.requireCloudBase().requestVerificationCode(phone);
  }

  async updateProfile(input: AccountProfileUpdateRequest): Promise<AccountSnapshot> {
    if (this.accountProvider === "cloudbase") {
      await this.ensureFreshSession(false);
      const profile = await this.requireCloudBase().updateProfile(input.displayName);
      this.updateSnapshot({ ...this.snapshot, status: "signed_in", profile });
      return this.getSnapshot();
    }
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
    if (this.accountProvider === "cloudbase") {
      await this.cloudbase?.signOut();
    } else if (current && this.supabase) {
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
    await this.sessionStore.clearRememberedLogin();
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
    if (this.accountProvider === "cloudbase") {
      try {
        const result =
          this.session.expiresAt - Math.floor(Date.now() / 1_000) <= REFRESH_EARLY_SECONDS
            ? await this.requireCloudBase().refresh()
            : {
                session: this.session,
                profile: forceProfile
                  ? await this.requireCloudBase().getProfile()
                  : this.snapshot.profile,
              };
        if (!result.profile) throw new AccountDesktopError("account_profile_unavailable");
        if (result.session !== this.session) await this.acceptSession(result.session);
        this.scheduleRefresh();
        return { profile: result.profile, session: this.session };
      } catch (error) {
        if (error instanceof AccountDesktopError) throw error;
        throw new AccountDesktopError("account_session_expired", { cause: error });
      }
    }
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

  private async acceptSession(
    session: AccountApiSession,
    shouldPersist = this.rememberSession,
  ): Promise<void> {
    this.session = { ...session };
    this.rememberSession = shouldPersist;
    if (shouldPersist) {
      await this.sessionStore.write(this.session);
    } else {
      // A previous remembered session must not survive a deliberate opt-out.
      await this.sessionStore.clear();
    }
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
    this.rememberSession = true;
    await this.sessionStore.clear();
  }

  private async persistRememberedLogin(identifier: string, password: string): Promise<void> {
    if (!this.rememberSession) {
      await this.sessionStore.clearRememberedLogin();
      return;
    }
    await this.sessionStore.writeRememberedLogin({ identifier, password });
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
    if (!supabaseUrl || !publishableKey) return false;
    try {
      const base = new URL(supabaseUrl);
      const login = usernameLoginUrl ? new URL(usernameLoginUrl) : undefined;
      if (base.protocol !== "https:" || base.username || base.password) return false;
      if (
        login &&
        (login.protocol !== "https:" ||
          base.origin !== login.origin ||
          login.username ||
          login.password)
      )
        return false;
      this.supabase = createClient(base.origin, publishableKey, { auth: SUPABASE_AUTH_OPTIONS });
      this.supabaseUrl = base.origin;
      this.supabasePublishableKey = publishableKey;
      this.usernameLoginUrl = login?.toString();
      return true;
    } catch {
      return false;
    }
  }

  private configureProvider(status: AccountServerStatus): boolean {
    this.accountProvider = status.auth?.provider === "cloudbase" ? "cloudbase" : "supabase";
    if (this.accountProvider === "cloudbase") {
      const envId = status.auth?.cloudbaseEnvId?.trim() || process.env.CLOUDBASE_ENV_ID?.trim();
      const region =
        status.auth?.cloudbaseRegion?.trim() ||
        process.env.CLOUDBASE_REGION?.trim() ||
        "ap-shanghai";
      const publishableKey =
        process.env.CLOUDBASE_PUBLISHABLE_KEY?.trim() ||
        status.auth?.cloudbasePublishableKey?.trim();
      if (!envId || !publishableKey) return false;
      try {
        this.cloudbase = new CloudBaseAccountClient(
          {
            envId,
            region,
            publishableKey,
          },
          {
            onDiagnostic: (diagnostic) => {
              void this.log("warn", "CloudBase account request failed", { ...diagnostic }).catch(
                () => undefined,
              );
            },
          },
        );
        return true;
      } catch {
        return false;
      }
    }
    return this.configureSupabase(status);
  }

  private requireSupabase(): SupabaseClient {
    if (!this.supabase) throw new AccountDesktopError("account_not_configured");
    return this.supabase;
  }

  private requireCloudBase(): CloudBaseAccountClient {
    if (!this.cloudbase) throw new AccountDesktopError("account_not_configured");
    return this.cloudbase;
  }

  private async loginWithUsername(identifier: string, password: string): Promise<Session> {
    if (!this.usernameLoginUrl || !this.supabasePublishableKey) {
      throw new AccountDesktopError("account_username_login_unavailable");
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
      throw new AccountDesktopError("account_username_login_network_error", { cause: error });
    }
    const body = (await response.json().catch(() => ({}))) as UsernameLoginResponse;
    const serverCode = body.error?.code;
    if (serverCode === "account_invalid_credentials" && response.status < 500) {
      throw new AccountDesktopError("account_invalid_credentials");
    }
    if (serverCode === "account_network_error") {
      throw new AccountDesktopError("account_username_login_network_error");
    }
    if (
      serverCode === "account_username_login_unavailable" ||
      response.status === 404 ||
      response.status >= 500 ||
      !isUsableSession(body.session)
    ) {
      throw new AccountDesktopError("account_username_login_unavailable");
    }
    return body.session;
  }

  private setAuthCallbackMessage(message: string): AccountSnapshot {
    this.updateSnapshot({
      status: this.snapshot.status === "signed_in" ? "signed_in" : "signed_out",
      configured: this.snapshot.configured,
      guestAllowed: this.snapshot.guestAllowed,
      developmentConnection: this.developmentConnection,
      profile: this.snapshot.status === "signed_in" ? this.snapshot.profile : undefined,
      message,
    });
    return this.getSnapshot();
  }

  private authCallbackErrorCode(error: unknown): string {
    const detail =
      error && typeof error === "object"
        ? `${"code" in error ? String(error.code) : ""} ${"message" in error ? String(error.message) : ""}`
        : String(error ?? "");
    const normalized = detail.toLowerCase();
    if (normalized.includes("expired") || normalized.includes("otp_expired")) {
      return "account_email_verification_expired";
    }
    if (normalized.includes("cancel") || normalized.includes("access_denied")) {
      return "account_email_verification_cancelled";
    }
    return normalized.includes("account_not_configured")
      ? "account_not_configured"
      : "account_email_verification_failed";
  }

  private validateRegistration(
    username: string,
    email: string,
    password: string,
    displayName: string,
  ): void {
    const isValidUsername =
      username.length >= 3 &&
      username.length <= 32 &&
      USERNAME_EDGE_CHARACTER.test(username[0] ?? "") &&
      USERNAME_EDGE_CHARACTER.test(username.at(-1) ?? "") &&
      /[a-z]/i.test(username) &&
      Array.from(username).every((character) => USERNAME_ALLOWED_CHARACTER.test(character));
    if (!isValidUsername) {
      throw new AccountDesktopError("account_username_invalid");
    }
    if (RESERVED_USERNAMES.has(username.toLowerCase())) {
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
