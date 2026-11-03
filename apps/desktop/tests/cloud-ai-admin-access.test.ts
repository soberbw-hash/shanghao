import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import type { AccountBackend } from "../../../packages/signaling/src/account-service";
import { CloudAiAdminAccess } from "../../../packages/signaling/src/cloud-ai-admin-access";

/* eslint-disable security/detect-possible-timing-attacks -- Fake test tokens, never production authentication. */
const accounts = {
  configured: true,
  verifyAccessToken: async (token: string) => {
    if (token === "admin") return { userId: "administrator-id" };
    if (token === "user") return { userId: "ordinary-id" };
    throw new Error("expired");
  },
} as unknown as AccountBackend;
const request = (authorization?: string) => ({ headers: { authorization } }) as IncomingMessage;

test("admin access requires secure transport, valid account and server allowlist on every call", async () => {
  const access = new CloudAiAdminAccess(accounts, () => true, " administrator-id ");
  assert.equal(await access.allows(request("Bearer admin")), true);
  for (const header of [
    undefined,
    "Bearer user",
    "Bearer expired",
    "admin",
    "Bearer admin extra",
  ]) {
    assert.equal(await access.allows(request(header)), false);
  }
  assert.equal(
    await new CloudAiAdminAccess(accounts, () => false, "administrator-id").allows(
      request("Bearer admin"),
    ),
    false,
  );
  assert.equal(
    await new CloudAiAdminAccess(accounts, () => true, "").allows(request("Bearer admin")),
    false,
  );
  assert.equal(
    await new CloudAiAdminAccess(
      { ...accounts, configured: false },
      () => true,
      "administrator-id",
    ).allows(request("Bearer admin")),
    false,
  );
});
