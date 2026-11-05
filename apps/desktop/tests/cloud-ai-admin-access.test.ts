import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { CloudAiAdminAccess } from "../../../packages/signaling/src/cloud-ai-admin-access";

test("admin access requires the configured key and secure transport, independent of account", async () => {
  const old = process.env.CLOUD_AI_ADMIN_KEY_SHA256;
  const key = "A".repeat(43);
  const request = (supplied?: string) =>
    ({
      headers: { "x-shanghao-admin-key": supplied, authorization: "Bearer admin" },
    }) as IncomingMessage;
  try {
    process.env.CLOUD_AI_ADMIN_KEY_SHA256 = createHash("sha256").update(key).digest("hex");
    assert.equal(await new CloudAiAdminAccess(() => true).allows(request(key)), true);
    assert.equal(await new CloudAiAdminAccess(() => true).allows(request("B".repeat(43))), false);
    assert.equal(await new CloudAiAdminAccess(() => true).allows(request()), false);
    assert.equal(await new CloudAiAdminAccess(() => false).allows(request(key)), false);
    delete process.env.CLOUD_AI_ADMIN_KEY_SHA256;
    assert.equal(await new CloudAiAdminAccess(() => true).allows(request(key)), false);
  } finally {
    if (old === undefined) delete process.env.CLOUD_AI_ADMIN_KEY_SHA256;
    else process.env.CLOUD_AI_ADMIN_KEY_SHA256 = old;
  }
});
