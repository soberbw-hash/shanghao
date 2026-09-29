import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AccountDesktopService } from "../src/main/account-service";
import { AccountDesktopError } from "../src/main/account-errors";
import { AccountSessionStore } from "../src/main/account-session-store";
import type { CloudBaseAccountClient } from "../src/main/cloudbase-account";

test("an unreachable profile server does not erase a remembered session", async () => {
  let cleared = 0;
  const store = {
    read: async () => ({
      accessToken: "test-access",
      refreshToken: "test-refresh",
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      tokenType: "bearer",
      provider: "supabase" as const,
    }),
    clear: async () => {
      cleared += 1;
    },
  } as unknown as AccountSessionStore;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/api/account/status")) {
      return Response.json({
        configured: true,
        auth: {
          provider: "supabase",
          supabaseUrl: "https://supabase.example",
          publishableKey: "test-publishable-key",
        },
      });
    }
    throw new Error("offline");
  };
  const account = new AccountDesktopService(store, () => "wss://voice.example/ws", fetcher);
  const snapshot = await account.initialize();
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.message, "account_server_unreachable");
  assert.equal(cleared, 0);
  account.dispose();
});

test("an invalid remembered session is distinguished from a temporary server failure", async () => {
  let cleared = 0;
  const store = {
    read: async () => ({
      accessToken: "invalid-access",
      refreshToken: "invalid-refresh",
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      tokenType: "bearer",
      provider: "supabase" as const,
    }),
    clear: async () => {
      cleared += 1;
    },
  } as unknown as AccountSessionStore;
  const fetcher: typeof fetch = async (input) =>
    String(input).endsWith("/api/account/status")
      ? Response.json({
          configured: true,
          auth: {
            provider: "supabase",
            supabaseUrl: "https://supabase.example",
            publishableKey: "test-publishable-key",
          },
        })
      : Response.json({ error: { code: "account_session_expired" } }, { status: 401 });
  const account = new AccountDesktopService(store, () => "wss://voice.example/ws", fetcher);
  const snapshot = await account.initialize();
  assert.equal(snapshot.status, "signed_out");
  assert.equal(snapshot.message, "account_session_expired");
  assert.equal(cleared, 0);
  account.dispose();
});

test("CloudBase hydration restores encrypted credentials before reading the profile", async () => {
  const session = {
    accessToken: "cloudbase-access",
    refreshToken: "cloudbase-refresh",
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    tokenType: "Bearer",
    provider: "cloudbase" as const,
  };
  const profile = { userId: "account-1", username: "tester", displayName: "Tester" };
  const calls: string[] = [];
  const store = { read: async () => session } as unknown as AccountSessionStore;
  const cloudbase = {
    restore: async (persisted: typeof session) => {
      assert.equal(persisted, session);
      calls.push("restore");
      return { session, profile };
    },
    getProfile: async () => {
      calls.push("getProfile");
      throw new Error("profile queried before credentials were restored");
    },
  } as unknown as CloudBaseAccountClient;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/api/account/status")) {
      return Response.json({ configured: true, guestAllowed: false });
    }
    calls.push("relayProfile");
    return Response.json({ profile });
  };
  const account = new AccountDesktopService(store, () => "wss://voice.example/ws", fetcher);
  Object.assign(account, {
    accountProvider: "cloudbase",
    cloudbase,
    localCloudbaseConfig: { envId: "test", region: "ap-shanghai", publishableKey: "test" },
  });
  const snapshot = await account.initialize();
  assert.equal(snapshot.status, "signed_in");
  assert.deepEqual(calls, ["restore", "relayProfile"]);
  account.dispose();
});

test("Supabase refresh separates retryable transport failures from rejected tokens", async () => {
  const account = new AccountDesktopService(
    {} as AccountSessionStore,
    () => "wss://voice.example/ws",
    async () => Response.json({}),
  );
  const state = account as unknown as {
    session: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      tokenType: string;
    };
    supabase: { auth: { refreshSession: () => Promise<never> } };
    ensureFreshSession: (forceProfile: boolean) => Promise<unknown>;
  };
  state.session = {
    accessToken: "expired-access",
    refreshToken: "refresh-token",
    expiresAt: Math.floor(Date.now() / 1_000) - 1,
    tokenType: "bearer",
  };
  state.supabase = {
    auth: {
      refreshSession: async () => Promise.reject({ name: "AuthRetryableFetchError", status: 0 }),
    },
  };
  await assert.rejects(state.ensureFreshSession(false), (error: unknown) => {
    assert.ok(error instanceof AccountDesktopError);
    assert.equal(error.code, "account_network_error");
    return true;
  });
  state.supabase.auth.refreshSession = async () => Promise.reject({ status: 400 });
  await assert.rejects(state.ensureFreshSession(false), (error: unknown) => {
    assert.ok(error instanceof AccountDesktopError);
    assert.equal(error.code, "account_session_expired");
    return true;
  });
});

test("encrypted account stores treat only missing files as an empty session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-account-read-"));
  try {
    const store = new AccountSessionStore(root);
    assert.equal(await store.read(), undefined);
    assert.equal(await store.readRememberedLogin(), undefined);
    await mkdir(path.join(root, "account-session.bin"));
    await mkdir(path.join(root, "account-login.bin"));
    await assert.rejects(store.read());
    await assert.rejects(store.readRememberedLogin());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a remembered session retries a transient profile failure and recovers in place", async () => {
  let reads = 0;
  let profileAttempts = 0;
  const store = {
    read: async () => {
      reads += 1;
      return {
        accessToken: "test-access",
        refreshToken: "test-refresh",
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        tokenType: "bearer",
        provider: "supabase" as const,
      };
    },
  } as unknown as AccountSessionStore;
  const profile = { userId: "account-1", username: "tester", displayName: "Tester" };
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/api/account/status")) {
      return Response.json({
        configured: true,
        auth: {
          provider: "supabase",
          supabaseUrl: "https://supabase.example",
          publishableKey: "test-publishable-key",
        },
      });
    }
    profileAttempts += 1;
    if (profileAttempts === 1) throw new Error("offline");
    return Response.json({ profile });
  };
  const account = new AccountDesktopService(
    store,
    () => "wss://voice.example/ws",
    fetcher,
    undefined,
    false,
    [5],
  );
  try {
    const restored = new Promise<void>((resolve) => {
      account.on("change", (snapshot) => {
        if (snapshot.status === "signed_in") resolve();
      });
    });
    assert.equal((await account.initialize()).status, "unavailable");
    await Promise.race([
      restored,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("recovery_timeout")), 500),
      ),
    ]);
    assert.equal(account.getSnapshot().profile?.userId, profile.userId);
    assert.equal(reads, 2);
    assert.equal(profileAttempts, 2);
  } finally {
    account.dispose();
  }
});

test("an explicit logout cancels a pending remembered-session retry", async () => {
  let reads = 0;
  let cleared = 0;
  const store = {
    read: async () => {
      reads += 1;
      return {
        accessToken: "test-access",
        refreshToken: "test-refresh",
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        tokenType: "bearer",
        provider: "supabase" as const,
      };
    },
    clear: async () => {
      cleared += 1;
    },
    clearRememberedLogin: async () => undefined,
  } as unknown as AccountSessionStore;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).endsWith("/api/account/status")) {
      return Response.json({
        configured: true,
        auth: {
          provider: "supabase",
          supabaseUrl: "https://supabase.example",
          publishableKey: "test-publishable-key",
        },
      });
    }
    throw new Error("offline");
  };
  const account = new AccountDesktopService(
    store,
    () => "wss://voice.example/ws",
    fetcher,
    undefined,
    false,
    [5],
  );
  try {
    assert.equal((await account.initialize()).status, "unavailable");
    assert.equal((await account.logout()).status, "signed_out");
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(reads, 1);
    assert.equal(cleared, 1);
  } finally {
    account.dispose();
  }
});

test("CloudBase restore retries a transient SDK failure without discarding the session", async () => {
  const session = {
    accessToken: "cloudbase-access",
    refreshToken: "cloudbase-refresh",
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    tokenType: "Bearer",
    provider: "cloudbase" as const,
  };
  const profile = { userId: "account-1", username: "tester", displayName: "Tester" };
  let restores = 0;
  const cloudbase = {
    restore: async () => {
      restores += 1;
      if (restores === 1) throw new AccountDesktopError("account_network_error");
      return { session, profile };
    },
  } as unknown as CloudBaseAccountClient;
  const store = { read: async () => session } as unknown as AccountSessionStore;
  const fetcher: typeof fetch = async (input) =>
    String(input).endsWith("/api/account/status")
      ? Response.json({ configured: true, guestAllowed: false })
      : Response.json({ profile });
  const account = new AccountDesktopService(
    store,
    () => "wss://voice.example/ws",
    fetcher,
    undefined,
    false,
    [5],
  );
  Object.assign(account, {
    accountProvider: "cloudbase",
    cloudbase,
    localCloudbaseConfig: { envId: "test", region: "ap-shanghai", publishableKey: "test" },
  });
  try {
    const restored = new Promise<void>((resolve) => {
      account.on("change", (snapshot) => {
        if (snapshot.status === "signed_in") resolve();
      });
    });
    assert.equal((await account.initialize()).status, "unavailable");
    await Promise.race([
      restored,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("recovery_timeout")), 500),
      ),
    ]);
    assert.equal(restores, 2);
    assert.equal(account.getSnapshot().profile?.userId, profile.userId);
  } finally {
    account.dispose();
  }
});
