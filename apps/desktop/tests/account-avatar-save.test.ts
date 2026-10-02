import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  ACCOUNT_AVATAR_PRESET_IDS,
  type AccountAvatarPresetId,
  type AccountProfile,
  type AccountSnapshot,
} from "@private-voice/shared";
import {
  AccountHttpController,
  AccountServerError,
  type AccountBackend,
} from "@private-voice/signaling";
import { AccountDesktopService } from "../src/main/account-service";
import { accountErrorMessage } from "../src/renderer/src/features/account/accountMessages";

const account = (userId = "owner-a"): AccountProfile => ({
  userId,
  username: userId,
  displayName: userId,
  accountAvatarPresetId: "sky-cat",
});
const setup = async (t: test.TestContext, presets = true) => {
  const saved = new Map<string, AccountProfile>();
  const changes: AccountProfile[] = [];
  let uploads = 0;
  const backend = {
    configured: true,
    getProfile: async (token: string) => {
      const userId = token.startsWith("token-a")
        ? "owner-a"
        : token === "token-b"
          ? "owner-b"
          : undefined;
      if (!userId) throw new AccountServerError("account_session_expired");
      return saved.get(userId) ?? account(userId);
    },
    updateAvatar: async (token: string) => {
      uploads++;
      return backend.getProfile(token);
    },
    ...(presets
      ? {
          updateAvatarPreset: async (token: string, id: AccountAvatarPresetId) => {
            const profile = { ...(await backend.getProfile(token)), accountAvatarPresetId: id };
            saved.set(profile.userId, profile);
            return profile;
          },
        }
      : {}),
  } as unknown as AccountBackend;
  const controller = new AccountHttpController(backend, undefined, (profile) => {
    changes.push(profile);
  });
  const server = createServer((request, response) => {
    void controller.handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const update = (body: object, token = "token-a") =>
    fetch(`http://127.0.0.1:${address.port}/api/account/avatar`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { update, saved, changes, uploads: () => uploads };
};

test("all 32 built-in avatars save through the real HTTP route without image uploads", async (t) => {
  const f = await setup(t);
  for (const id of ACCOUNT_AVATAR_PRESET_IDS) {
    const response = await f.update({ accountAvatarPresetId: id });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).profile.accountAvatarPresetId, id);
  }
  assert.equal(f.changes.length, 32);
  assert.equal(f.uploads(), 0);
  assert.equal(f.saved.get("owner-a")?.accountAvatarPresetId, "apricot-squirrel");
});

test("preset limits are per verified account, survive token rotation and allow a shared-IP second account", async (t) => {
  const f = await setup(t);
  for (let i = 0; i < 60; i++)
    assert.equal((await f.update({ accountAvatarPresetId: "peach-fox" })).status, 200);
  const limited = await f.update({ accountAvatarPresetId: "mint-bear" }, "token-a-rotated");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await limited.json()).error.code, "account_rate_limited");
  assert.equal((await f.update({ accountAvatarPresetId: "mint-bear" }, "token-b")).status, 200);
  assert.equal(f.saved.get("owner-a")?.accountAvatarPresetId, "peach-fox");
  assert.equal(f.saved.get("owner-b")?.accountAvatarPresetId, "mint-bear");
  assert.equal(f.changes.length, 61);
});

test("invalid identities and unknown preset IDs cannot update an account or consume its preset allowance", async (t) => {
  const f = await setup(t);
  assert.equal(
    (await f.update({ accountAvatarPresetId: "peach-fox" }, "invalid-token")).status,
    401,
  );
  const bad = await f.update({ accountAvatarPresetId: "not-a-built-in" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, "account_avatar_invalid");
  assert.equal(f.saved.size, 0);
  assert.equal(f.changes.length, 0);
  assert.equal((await f.update({ accountAvatarPresetId: "jade-dragon" })).status, 200);
});

test("custom image uploads retain the eight-per-ten-minute limit and return the actual remaining wait", async (t) => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ["Date"], now });
  const f = await setup(t, false);
  for (let i = 0; i < 8; i++)
    assert.equal((await f.update({ dataUrl: "image-fixture" })).status, 200);
  const blocked = await f.update({ dataUrl: "image-fixture" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "600");
  assert.equal((await blocked.json()).error.retryAfterSeconds, 600);
  t.mock.timers.tick(599_000);
  assert.equal((await f.update({ dataUrl: "image-fixture" })).headers.get("retry-after"), "1");
  t.mock.timers.tick(1_000);
  assert.equal((await f.update({ dataUrl: "image-fixture" })).status, 200);
  assert.equal(f.uploads(), 9);
  assert.doesNotMatch(accountErrorMessage("account_rate_limited"), /一分钟/);
});

test("a backend with preset support still accepts custom images with their separate limit", async (t) => {
  const f = await setup(t);
  for (let i = 0; i < 8; i++)
    assert.equal((await f.update({ dataUrl: "image-fixture" })).status, 200);
  assert.equal((await f.update({ dataUrl: "image-fixture" })).status, 429);
  assert.equal(f.uploads(), 8);
  assert.equal((await f.update({ accountAvatarPresetId: "peach-fox" })).status, 200);
});

test("the public avatar endpoint remains bounded before authentication", async (t) => {
  const f = await setup(t);
  for (let i = 0; i < 120; i++)
    assert.equal(
      (await f.update({ accountAvatarPresetId: "peach-fox" }, "invalid-token")).status,
      401,
    );
  assert.equal(
    (await f.update({ accountAvatarPresetId: "peach-fox" }, "invalid-token")).status,
    429,
  );
  assert.equal(f.changes.length, 0);
});

test("late avatar replies cannot replace the current account or another server's profile", async () => {
  for (const change of ["user", "server", "wrong-response", "signed-out"] as const) {
    let serverUrl = "wss://fixture-one.example";
    let accept!: (profile: AccountProfile) => void;
    let persisted = 0;
    const service = new AccountDesktopService({} as never, () => serverUrl, fetch);
    const internal = service as unknown as {
      accountProvider: string;
      snapshot: AccountSnapshot;
      authorizedProfileRequest: () => Promise<AccountProfile>;
      refreshRememberedProfile: () => Promise<void>;
    };
    internal.accountProvider = "cloudbase";
    internal.snapshot = {
      status: "signed_in",
      configured: true,
      guestAllowed: false,
      profile: account(),
    };
    internal.authorizedProfileRequest = () =>
      new Promise((resolve) => {
        accept = resolve;
      });
    internal.refreshRememberedProfile = async () => {
      persisted++;
    };
    const operation = service.updateAvatar({ accountAvatarPresetId: "peach-fox" });
    if (change === "user")
      internal.snapshot = { ...internal.snapshot, profile: account("owner-b") };
    if (change === "server") serverUrl = "wss://fixture-two.example";
    if (change === "signed-out")
      internal.snapshot = { ...internal.snapshot, status: "signed_out", profile: undefined };
    const expected = structuredClone(internal.snapshot);
    accept({
      ...account(change === "wrong-response" ? "owner-b" : "owner-a"),
      accountAvatarPresetId: "peach-fox",
    });
    await assert.rejects(operation, /account_session_expired/);
    assert.deepEqual(service.getSnapshot(), expected);
    assert.equal(persisted, 0);
  }
});
