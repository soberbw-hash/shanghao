import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION, type AccountProfile } from "@private-voice/shared";
import {
  SignalingServer,
  type AccountAuthResult,
  type AccountBackend,
  type VerifiedAccountIdentity,
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
        appVersion: "3.0.3",
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
