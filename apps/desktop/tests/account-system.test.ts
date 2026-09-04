import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION, type AccountProfile } from "@private-voice/shared";
import {
  SignalingServer,
  CloudBaseAccountService,
  type AccountAuthResult,
  type AccountBackend,
  type VerifiedAccountIdentity,
  resolveSupabaseEnvironmentKey,
} from "@private-voice/signaling";
import { WebSocket } from "ws";

const profile: AccountProfile = {
  userId: "926f761a-fbbf-4967-99b0-cea040a56f30",
  username: "sober_test",
  displayName: "服务端名字",
  email: "owner@example.com",
};

const session = {
  accessToken: "access-token-for-main-process-only",
  refreshToken: "refresh-token-for-safe-storage-only",
  expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
  tokenType: "bearer",
};

class FakeAccountBackend implements AccountBackend {
  readonly configured = true;
  loginInputs: Array<{ identifier: string; password: string }> = [];

  async register(): Promise<AccountAuthResult> {
    return { profile, session };
  }

  async login(identifier: string, password: string): Promise<AccountAuthResult> {
    this.loginInputs.push({ identifier, password });
    return { profile, session };
  }

  async refresh(): Promise<AccountAuthResult> {
    return { profile, session };
  }

  async requestPasswordReset(): Promise<void> {}

  async getProfile(): Promise<AccountProfile> {
    return profile;
  }

  async updateProfile(_token: string, displayName: string): Promise<AccountProfile> {
    return { ...profile, displayName };
  }

  async updateAvatar(): Promise<AccountProfile> {
    return { ...profile, avatarUrl: "https://example.com/avatar.webp" };
  }

  async verifyAccessToken(accessToken: string): Promise<VerifiedAccountIdentity> {
    if (accessToken !== "valid-account-token") throw new Error("invalid_token");
    return {
      userId: profile.userId,
      username: profile.username,
      displayName: profile.displayName,
    };
  }
}

class DelayedAccountBackend extends FakeAccountBackend {
  override async verifyAccessToken(accessToken: string): Promise<VerifiedAccountIdentity> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return super.verifyAccessToken(accessToken);
  }
}

const waitForMessage = <T>(socket: WebSocket, predicate: (value: unknown) => value is T) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);
    const onMessage = (raw: Buffer) => {
      const parsed = JSON.parse(raw.toString()) as unknown;
      if (!predicate(parsed)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(parsed);
    };
    socket.on("message", onMessage);
  });

test("account HTTP endpoints keep username resolution server-side and rate limit login", async () => {
  const backend = new FakeAccountBackend();
  const logs: Array<{ message: string; context?: Record<string, unknown> }> = [];
  const server = new SignalingServer({
    roomName: "账号接口测试",
    accountBackend: backend,
    logger: (message, context) => logs.push({ message, context }),
  });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const status = await fetch(`${base}/api/account/status`).then((response) => response.json());
    assert.equal(status.configured, true);

    for (let index = 0; index < 8; index += 1) {
      const response = await fetch(`${base}/api/account/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: "sober_test", password: "never-log-this" }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as AccountAuthResult;
      assert.equal(body.profile.userId, profile.userId);
    }
    const limited = await fetch(`${base}/api/account/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: "sober_test", password: "never-log-this" }),
    });
    assert.equal(limited.status, 429);
    assert.equal(backend.loginInputs.length, 8);
    assert.equal(JSON.stringify(logs).includes("never-log-this"), false);
    assert.equal(JSON.stringify(logs).includes(session.accessToken), false);
  } finally {
    await server.close();
  }
});

test("authenticated room identity ignores forged client profile and nickname", async () => {
  const server = new SignalingServer({
    roomName: "身份测试",
    accountBackend: new FakeAccountBackend(),
  });
  const port = await server.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { Authorization: "Bearer valid-account-token" },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const snapshotPromise = waitForMessage(
      socket,
      (value): value is { type: "channel_snapshot"; members: Array<Record<string, unknown>> } =>
        Boolean(
          value &&
          typeof value === "object" &&
          (value as { type?: string }).type === "channel_snapshot" &&
          Array.isArray((value as { members?: unknown }).members),
        ),
    );
    socket.send(
      JSON.stringify({
        type: "join_channel",
        roomId: "main",
        channelId: "main",
        peerId: "account-peer",
        profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        nickname: "伪造名字",
        avatarId: "fox",
        appVersion: "3.0.4",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
      }),
    );
    const snapshot = await snapshotPromise;
    const member = snapshot.members.find((candidate) => candidate.id === "account-peer");
    assert.equal(member?.userId, profile.userId);
    assert.equal(member?.profileId, profile.userId);
    assert.equal(member?.username, profile.username);
    assert.equal(member?.displayName, profile.displayName);
    assert.equal(member?.nickname, profile.displayName);
    assert.equal(member?.isGuest, false);
  } finally {
    socket.close();
    await server.close();
  }
});

test("join request sent during slow account verification is replayed after authorization", async () => {
  const server = new SignalingServer({
    roomName: "慢鉴权进房测试",
    accountBackend: new DelayedAccountBackend(),
  });
  const port = await server.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { Authorization: "Bearer valid-account-token" },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const joinAckPromise = waitForMessage(
      socket,
      (value): value is { type: "join_ack"; peerId: string } =>
        Boolean(
          value && typeof value === "object" && (value as { type?: string }).type === "join_ack",
        ),
    );
    socket.send(
      JSON.stringify({
        type: "join_channel",
        roomId: "main",
        channelId: "main",
        peerId: "slow-auth-peer",
        profileId: profile.userId,
        nickname: profile.displayName,
        avatarId: "fox",
        appVersion: "3.0.6",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
      }),
    );
    const joinAck = await joinAckPromise;
    assert.equal(joinAck.peerId, "slow-auth-peer");
  } finally {
    socket.close();
    await server.close();
  }
});

test("invalid bearer token is rejected before room messages are accepted", async () => {
  const server = new SignalingServer({
    roomName: "无效令牌测试",
    accountBackend: new FakeAccountBackend(),
  });
  const port = await server.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { Authorization: "Bearer invalid-account-token" },
  });
  try {
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    const result = await closed;
    assert.equal(result.code, 4401);
    assert.equal(result.reason, "invalid_access_token");
  } finally {
    socket.close();
    await server.close();
  }
});

test("Supabase migration keeps login mapping private and derives profiles atomically", async () => {
  const migrationUrl = new URL(
    "../../../supabase/migrations/202608240001_accounts_v1.sql",
    import.meta.url,
  );
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /private\.username_login_map/i);
  assert.match(sql, /revoke all on private\.username_login_map from public, anon, authenticated/i);
  assert.match(sql, /after insert on auth\.users/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /to service_role/i);
  assert.doesNotMatch(sql, /sb_secret_/i, "migration must not contain a real key value");
});

test("registration offers ten local SVG avatar presets without embedding remote content", async () => {
  const avatarDirectory = new URL("../src/renderer/src/assets/account-avatars/", import.meta.url);
  const avatarFiles = (await readdir(avatarDirectory)).filter((name) => name.endsWith(".svg"));
  assert.equal(avatarFiles.length, 10);
  for (const avatarFile of avatarFiles) {
    const source = await readFile(new URL(avatarFile, avatarDirectory), "utf8");
    assert.match(source, /^<svg[\s>]/);
    assert.doesNotMatch(source, /<script|(?:href|src)=["']https?:\/\//i);
  }
});

test("registration form stays compact and scrollable in a short window", async () => {
  const accountPage = await readFile(
    new URL("../src/renderer/src/pages/AccountPage.tsx", import.meta.url),
    "utf8",
  );
  const accountStyles = await readFile(
    new URL("../src/renderer/src/styles/parts/150-account.css", import.meta.url),
    "utf8",
  );

  assert.match(accountPage, /account-register-grid/);
  assert.match(accountPage, /requestVerificationCode/);
  assert.match(accountPage, /verificationCountdown/);
  assert.match(accountPage, /手机号/);
  assert.match(accountPage, /account-phone-prefix/);
  assert.match(accountPage, /\+86/);
  assert.doesNotMatch(accountPage, /showVerificationNotice/);
  assert.doesNotMatch(accountPage, /emailRedirectTo/);
  assert.match(
    accountStyles,
    /\.account-page\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow-y:\s*auto;/,
  );
  assert.match(accountStyles, /\.account-register-grid\s*\{[\s\S]*grid-template-columns:/);
  assert.match(accountStyles, /\.account-register-grid\s*\{[\s\S]*min-width:\s*0/);
  assert.match(accountStyles, /\.account-field\s*\{[\s\S]*min-width:\s*0/);
  assert.match(
    accountStyles,
    /\.account-field > div\s*\{[\s\S]*box-sizing:\s*border-box[\s\S]*width:\s*100%[\s\S]*min-width:\s*0/,
  );
});

test("remembered login uses Electron secure storage and only explicit logout clears it", async () => {
  const accountPage = await readFile(
    new URL("../src/renderer/src/pages/AccountPage.tsx", import.meta.url),
    "utf8",
  );
  const accountService = await readFile(
    new URL("../src/main/account-service.ts", import.meta.url),
    "utf8",
  );
  const sessionStore = await readFile(
    new URL("../src/main/account-session-store.ts", import.meta.url),
    "utf8",
  );

  assert.match(accountPage, /getRememberedLogin\(\)/);
  assert.match(accountPage, /setPassword\(\(current\) => current \|\| remembered\.password\)/);
  assert.match(accountPage, /AccountLoginSummary/);
  assert.match(accountPage, /return <HomePage \/>/);
  assert.doesNotMatch(accountPage, /automaticEntryIdentity=/);
  assert.match(sessionStore, /safeStorage\.encryptStringAsync/);
  assert.match(sessionStore, /account-login\.bin/);
  assert.match(accountService, /async logout\(\)[\s\S]*clearRememberedLogin\(\)/);
  const clearSessionBody = accountService.match(
    /private async clearSession\(\)[\s\S]*?\n {2}\}/,
  )?.[0];
  assert.ok(clearSessionBody);
  assert.doesNotMatch(clearSessionBody, /clearRememberedLogin\(\)/);
});

test("signed-in joins rely on verified access-token identity for legacy relay compatibility", async () => {
  const roomState = await readFile(
    new URL("../src/renderer/src/hooks/useRoomState.ts", import.meta.url),
    "utf8",
  );
  const roomClient = await readFile(
    new URL("../src/renderer/src/features/room/roomClient.ts", import.meta.url),
    "utf8",
  );

  assert.match(roomState, /accountSnapshot\.status === "signed_in" \? undefined : localProfileId/);
  assert.match(roomClient, /profileId\?: string/);
});

test("old account servers are identified before credentials can be submitted", async () => {
  const desktopService = await readFile(
    new URL("../src/main/account-service.ts", import.meta.url),
    "utf8",
  );
  const accountPage = await readFile(
    new URL("../src/renderer/src/pages/AccountPage.tsx", import.meta.url),
    "utf8",
  );
  const messages = await readFile(
    new URL("../src/renderer/src/features/account/accountMessages.ts", import.meta.url),
    "utf8",
  );

  assert.match(desktopService, /response\.status === 404[\s\S]*account_server_upgrade_required/);
  assert.match(accountPage, /accountServiceReady = snapshot\.configured/);
  assert.match(accountPage, /isBusy \|\| !accountServiceReady/);
  assert.match(messages, /当前房间服务器还是旧版本/);
  assert.match(messages, /未启用账号开发测试连接/);
});

test("CloudBase relay verification derives identity from the verified token", async () => {
  const requests: Array<{ url: string; authorization?: string }> = [];
  const backend = new CloudBaseAccountService({
    envId: "shanghao-test",
    region: "ap-shanghai",
    publishableKey: "cloudbase-publishable-test-key",
    fetcher: async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization") ?? undefined,
      });
      if (String(input).endsWith("/token/introspect")) {
        return new Response(JSON.stringify({ sub: "cloudbase-user-1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          sub: "cloudbase-user-1",
          username: "sober_test",
          name: "服务端名字",
          phone_number: "+8613800000000",
        }),
        { status: 200 },
      );
    },
  });

  const identity = await backend.verifyAccessToken("verified-cloudbase-token");
  assert.deepEqual(identity, {
    userId: "cloudbase-user-1",
    username: "sober_test",
    displayName: "服务端名字",
    avatarUrl: undefined,
  });
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0]?.url,
    "https://shanghao-test.api.tcloudbasegateway.com/auth/v1/token/introspect",
  );
  assert.equal(requests[1]?.url, "https://shanghao-test.api.tcloudbasegateway.com/auth/v1/user/me");
  assert.ok(
    requests.every((request) => request.authorization === "Bearer verified-cloudbase-token"),
  );
  assert.equal(backend.publicConfiguration?.provider, "cloudbase");
});

test("account verification and username login keep user-facing states separate", async () => {
  const desktopService = await readFile(
    new URL("../src/main/account-service.ts", import.meta.url),
    "utf8",
  );
  const deepLink = await readFile(new URL("../src/main/deep-link.ts", import.meta.url), "utf8");
  const edgeFunction = await readFile(
    new URL("../../../supabase/functions/shanghao-username-login/index.ts", import.meta.url),
    "utf8",
  );
  const messages = await readFile(
    new URL("../src/renderer/src/features/account/accountMessages.ts", import.meta.url),
    "utf8",
  );

  assert.match(desktopService, /emailRedirectTo:\s*SHANGHAO_AUTH_REDIRECT_URL/);
  assert.match(desktopService, /handleAuthDeepLink/);
  assert.match(desktopService, /account_username_login_unavailable/);
  assert.match(deepLink, /SHANGHAO_AUTH_REDIRECT_URL/);
  assert.match(edgeFunction, /lookupError[\s\S]*unavailable/);
  assert.match(edgeFunction, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(edgeFunction, /SUPABASE_SECRET_KEYS/);
  assert.match(messages, /用户名或密码错误/);
  assert.match(messages, /用户名登录服务暂时不可用，请使用邮箱登录/);
  assert.match(messages, /登录服务连接失败，请稍后重试/);
});

test("development relay never accepts password or refresh-token routes over plain HTTP", async () => {
  const controller = await readFile(
    new URL("../../../packages/signaling/src/account-http-controller.ts", import.meta.url),
    "utf8",
  );
  const desktopService = await readFile(
    new URL("../src/main/account-service.ts", import.meta.url),
    "utf8",
  );
  const edgeFunction = await readFile(
    new URL("../../../supabase/functions/shanghao-username-login/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(controller, /ALLOW_INSECURE_DEV_CONNECTION/);
  assert.match(controller, /SHANGHAO_DEPLOYMENT_MODE/);
  assert.match(controller, /TOKEN_ONLY_DEVELOPMENT_ROUTES/);
  assert.doesNotMatch(
    controller.match(/TOKEN_ONLY_DEVELOPMENT_ROUTES[\s\S]*?\]\);/)?.[0] ?? "",
    /login|register|refresh|password-reset/,
  );
  assert.match(desktopService, /signInWithPassword/);
  assert.match(desktopService, /refreshSession/);
  assert.doesNotMatch(
    desktopService,
    /"\/api\/account\/(?:login|register|refresh|password-reset)"/,
  );
  assert.match(edgeFunction, /resolve_account_email/);
  assert.doesNotMatch(edgeFunction, /console\.(?:log|error)/);
});

test("Supabase config prefers the named default key and falls back to the legacy key", () => {
  assert.equal(resolveSupabaseEnvironmentKey('{"default":" new-key "}', "old-key"), "new-key");
  assert.equal(resolveSupabaseEnvironmentKey('{"web":"web-key"}', " old-key "), "old-key");
  assert.equal(resolveSupabaseEnvironmentKey("{", " old-key "), "old-key");
  assert.equal(resolveSupabaseEnvironmentKey(undefined, " old-key "), "old-key");
  assert.equal(resolveSupabaseEnvironmentKey('{"default":""}', undefined), undefined);
});

test("desktop renderer and repository sources contain no server secret or refresh token API", async () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const renderer = await readFile(
    new URL("apps/desktop/src/renderer/src/store/accountStore.ts", repositoryRoot),
    "utf8",
  );
  const preload = await readFile(
    new URL("apps/desktop/src/preload/index.ts", repositoryRoot),
    "utf8",
  );
  assert.doesNotMatch(renderer, /refreshToken|SUPABASE_SECRET_KEY|service_role/);
  assert.doesNotMatch(preload, /refreshToken|SUPABASE_SECRET_KEY|service_role/);

  const scanRoots = ["apps", "packages", "scripts", "docs", "deploy", "supabase"];
  const sources: string[] = [];
  const visit = async (directory: URL): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (["node_modules", "dist", "dist-electron", "release"].includes(entry.name)) continue;
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (/\.(?:ts|tsx|mjs|js|json|md|sql|yml|yaml|example)$/.test(entry.name)) {
        const source = await readFile(child, "utf8").catch(() => undefined);
        if (source) sources.push(source);
      }
    }
  };
  for (const root of scanRoots) await visit(new URL(`${root}/`, repositoryRoot));
  assert.doesNotMatch(sources.join("\n"), /sb_secret_[A-Za-z0-9]{12,}/);
});
