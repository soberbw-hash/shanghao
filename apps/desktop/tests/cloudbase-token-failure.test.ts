import assert from "node:assert/strict";
import test from "node:test";
import { isInvalidCloudBaseTokenResponse } from "../../../packages/signaling/src/cloudbase-token-failure";
import {
  AccountServerError,
  CloudBaseAccountService,
} from "../../../packages/signaling/src/account-service";

test("malformed JWT HTTP 400 is distinguished from provider/configuration failures", () => {
  assert.equal(
    isInvalidCloudBaseTokenResponse(400, { code: "failed_precondition", message: "malformed JWT" }),
    true,
  );
  assert.equal(isInvalidCloudBaseTokenResponse(400, { error: { code: "invalid_token" } }), true);
  assert.equal(
    isInvalidCloudBaseTokenResponse(400, {
      code: "failed_precondition",
      message: "environment unavailable",
    }),
    false,
  );
  assert.equal(isInvalidCloudBaseTokenResponse(503, { message: "invalid token" }), false);
  assert.equal(isInvalidCloudBaseTokenResponse(400, null), false);
  assert.equal(isInvalidCloudBaseTokenResponse(401, {}), true);
});

test("both CloudBase endpoints map malformed credentials to expired sessions, preserving outages", async () => {
  for (const endpoint of ["introspection", "profile"] as const) {
    for (const invalid of [true, false]) {
      let calls = 0;
      const backend = new CloudBaseAccountService({
        envId: "test-only",
        fetcher: async () => {
          calls++;
          if (endpoint === "profile" && calls === 1) return Response.json({ sub: "fixture" });
          return Response.json(
            {
              code: "failed_precondition",
              message: invalid ? "malformed JWT" : "environment unavailable",
            },
            { status: 400 },
          );
        },
      });
      await assert.rejects(backend.verifyAccessToken("fixture-token"), (error: unknown) => {
        assert.ok(error instanceof AccountServerError);
        assert.equal(error.code, invalid ? "account_session_expired" : "account_network_error");
        return true;
      });
      assert.equal(calls, endpoint === "profile" ? 2 : 1);
    }
  }
});
