import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { create } from "zustand";
import type { AccountSnapshot } from "@private-voice/shared";

const signedIn: AccountSnapshot = {
  status: "signed_in",
  configured: true,
  guestAllowed: false,
  profile: { userId: "fixture", username: "fixture", displayName: "Fixture" },
};
const signedOut: AccountSnapshot = {
  status: "signed_out",
  configured: true,
  guestAllowed: false,
  message: "account_session_expired",
};
function fixture() {
  let event!: (snapshot: AccountSnapshot) => void,
    resolveSnapshot!: (snapshot: AccountSnapshot) => void;
  const pending = new Promise<AccountSnapshot>((resolve) => {
    resolveSnapshot = resolve;
  });
  type Store = {
    snapshot: AccountSnapshot;
    hydrate(): Promise<AccountSnapshot>;
    login(request: unknown): Promise<AccountSnapshot>;
  };
  const exported = {} as { useAccountStore: { getState(): Store } };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/renderer/src/store/accountStore.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  runInNewContext(source, {
    exports: exported,
    window: {
      desktopApi: {
        account: {
          onChanged: (listener: typeof event) => {
            event = listener;
            return () => undefined;
          },
          getSnapshot: () => pending,
          getRememberedLogin: async () => undefined,
          login: () => pending,
        },
      },
    },
    require: (id: string) => {
      if (id === "zustand") return { create };
      if (id === "../features/account/accountMessages") return { accountErrorCode: String };
      throw Error(id);
    },
  });
  return {
    store: exported.useAccountStore,
    event: (value: AccountSnapshot) => event(value),
    resolveSnapshot,
  };
}

test("a late hydrated profile cannot overwrite a newer signed-out account event", async () => {
  const f = fixture();
  const pending = f.store.getState().hydrate();
  f.event(signedOut);
  f.resolveSnapshot(signedIn);
  assert.equal((await pending).status, "signed_out");
  assert.equal(f.store.getState().snapshot.status, "signed_out");
  assert.equal(f.store.getState().snapshot.profile, undefined);
});

test("an old signed-out hydration cannot replace a successful sign-in event", async () => {
  const f = fixture();
  const pending = f.store.getState().hydrate();
  f.event(signedIn);
  f.resolveSnapshot(signedOut);
  assert.equal((await pending).status, "signed_in");
  assert.equal(f.store.getState().snapshot.profile?.userId, "fixture");
});
