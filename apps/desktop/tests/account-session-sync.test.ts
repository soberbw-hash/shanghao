import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocketServer } from "ws";
import { AccountDesktopService } from "../src/main/account-service";
import { AccountDesktopError } from "../src/main/account-errors";
import type {
  AccountSessionStore,
  PersistedAccountSession,
} from "../src/main/account-session-store";
import { CloudBaseAccountClient, type CloudBaseAccountAuth } from "../src/main/cloudbase-account";
import { SignalingClientBridge } from "../src/main/signaling-client";

const profile = { userId: "fixture-account", username: "fixture", displayName: "Fixture" };
const session = (accessToken: string, seconds = 3600): PersistedAccountSession => ({
  accessToken,
  refreshToken: "fixture-refresh",
  expiresAt: Math.floor(Date.now() / 1000) + seconds,
  tokenType: "Bearer",
  provider: "cloudbase",
});
function fixture(seconds = 3600) {
  const original = session("fixture-original", seconds);
  let sdkSession = original,
    refreshes = 0,
    clears = 0;
  const writes: PersistedAccountSession[] = [];
  const cloudbase = {
    getSession: async () => sdkSession,
    getProfile: async () => profile,
    login: async () => ({ profile, session: sdkSession }),
    refresh: async () => {
      refreshes++;
      return { profile, session: sdkSession };
    },
    signOut: async () => undefined,
  };
  const store = {
    write: async (value: PersistedAccountSession) => {
      writes.push(value);
    },
    clear: async () => {
      clears++;
    },
    clearRememberedLogin: async () => undefined,
    writeRememberedLogin: async () => undefined,
  } as unknown as AccountSessionStore;
  const account = new AccountDesktopService(
    store,
    () => "wss://fixture.invalid",
    async () => Response.json({ profile }),
  );
  Object.assign(account, {
    session: original,
    accountProvider: "cloudbase",
    cloudbase: cloudbase as unknown as CloudBaseAccountClient,
    snapshot: { status: "signed_in", configured: true, guestAllowed: false, profile },
  });
  return {
    account,
    cloudbase,
    original,
    writes,
    refreshes: () => refreshes,
    clears: () => clears,
    rotate: (next: PersistedAccountSession) => {
      sdkSession = next;
    },
  };
}

test("CloudBase SDK token rotation reaches private HTTP and WebSocket consumers even while the cached expiry is far away", async () => {
  const f = fixture();
  try {
    f.rotate(session("fixture-sdk-rotated"));
    assert.equal(await f.account.getFreshAccessToken(), "fixture-sdk-rotated");
    assert.equal(f.account.getAccessToken(), "fixture-sdk-rotated");
    assert.equal(f.writes.at(-1)?.accessToken, "fixture-sdk-rotated");
    assert.equal(f.clears(), 0);
  } finally {
    f.account.dispose();
  }
});

test("parallel token readers share one refresh so rotating provider credentials cannot race", async () => {
  const f = fixture(-1);
  let release!: () => void,
    count = 0;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.cloudbase.refresh = async () => {
    count++;
    await pending;
    return { profile, session: session("fixture-refreshed") };
  };
  try {
    const requests = [
      f.account.getFreshAccessToken(),
      f.account.getFreshAccessToken(),
      f.account.getFreshAccessToken(),
    ];
    await Promise.resolve();
    await Promise.resolve();
    release();
    assert.deepEqual(await Promise.all(requests), [
      "fixture-refreshed",
      "fixture-refreshed",
      "fixture-refreshed",
    ]);
    assert.equal(count, 1);
  } finally {
    release();
    f.account.dispose();
  }
});

test("a rejected refresh updates the account snapshot without deleting encrypted login data", async () => {
  const f = fixture(-1);
  f.cloudbase.refresh = async () => {
    throw new AccountDesktopError("account_session_expired");
  };
  try {
    await assert.rejects(f.account.getFreshAccessToken(), /account_session_expired/);
    assert.equal(f.account.getSnapshot().status, "signed_out");
    assert.equal(f.account.getSnapshot().profile, undefined);
    assert.equal(f.clears(), 0);
  } finally {
    f.account.dispose();
  }
});

test("a refresh completing after logout cannot restore the previous account or write its session", async () => {
  const f = fixture(-1);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.cloudbase.refresh = async () => {
    await pending;
    return { profile, session: session("fixture-too-late") };
  };
  try {
    const read = f.account.getFreshAccessToken();
    const rejected = assert.rejects(read, /account_session_expired/);
    await Promise.resolve();
    await Promise.resolve();
    await f.account.logout();
    release();
    await rejected;
    assert.equal(f.account.getSnapshot().status, "signed_out");
    assert.equal(f.account.getAccessToken(), undefined);
    assert.equal(f.writes.length, 0);
  } finally {
    release();
    f.account.dispose();
  }
});

test("CloudBase login cannot hide relay authentication rejection behind a local profile", async () => {
  const f = fixture();
  Object.assign(f.account, {
    fetcher: async () =>
      Response.json({ error: { code: "account_session_expired" } }, { status: 401 }),
    snapshot: { status: "signed_out", configured: true, guestAllowed: false },
  });
  try {
    await assert.rejects(
      f.account.login({ identifier: "fixture", password: "fixture-password" }),
      /account_session_expired/,
    );
    assert.notEqual(f.account.getSnapshot().status, "signed_in");
    assert.equal(f.clears(), 0);
  } finally {
    f.account.dispose();
  }
});

test("reading SDK credentials preserves retryable network errors instead of reporting an expired login", async () => {
  const client = new CloudBaseAccountClient(
    { envId: "fixture", region: "ap-shanghai", publishableKey: "fixture" },
    {
      auth: {
        getCredentials: async () => {
          throw Error("fetch failed");
        },
      } as unknown as CloudBaseAccountAuth,
    },
  );
  await assert.rejects(client.getSession(), (error: unknown) => {
    assert.ok(error instanceof AccountDesktopError);
    assert.equal(error.code, "account_network_error");
    return true;
  });
});

test("the real signaling bridge authenticates with SDK-rotated credentials kept inside Main", async () => {
  const f = fixture();
  f.rotate(session("fixture-sdk-rotated"));
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: (info) => info.req.headers.authorization === "Bearer fixture-sdk-rotated",
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const bridge = new SignalingClientBridge(
    async () => undefined,
    () => f.account.getFreshAccessToken(),
  );
  try {
    await bridge.connect(`ws://127.0.0.1:${address.port}`, "fixture-auth");
    await bridge.send('{"type":"heartbeat"}', "fixture-auth");
  } finally {
    await bridge.close("fixture-auth");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.account.dispose();
  }
});
