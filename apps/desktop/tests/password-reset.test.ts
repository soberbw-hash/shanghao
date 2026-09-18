import assert from "node:assert/strict";
import test from "node:test";
import { CloudBaseAccountClient, type CloudBaseAccountAuth } from "../src/main/cloudbase-account";

const fixture = () => {
  const submitted: unknown[] = [];
  let failure = false;
  const client = new CloudBaseAccountClient(
    { envId: "test", region: "ap-shanghai", publishableKey: "test" },
    {
      auth: {
        resetPasswordForEmail: async () => ({
          data: {
            updateUser: async (input: unknown) => {
              submitted.push(input);
              return failure ? { error: { code: "invalid_verification_code" } } : { data: {} };
            },
          },
        }),
      } as unknown as CloudBaseAccountAuth,
    },
  );
  return {
    client,
    submitted,
    fail: (value: boolean) => {
      failure = value;
    },
  };
};

test("password reset requires an issued challenge bound to the same account", async () => {
  const { client, submitted } = fixture();
  await assert.rejects(client.requestPasswordReset("13800000000", "123456", "TestPass123"), {
    code: "account_verification_expired",
  });
  await client.requestPasswordReset("13800000000");
  await assert.rejects(client.requestPasswordReset("13900000000", "123456", "TestPass123"), {
    code: "account_verification_expired",
  });
  assert.equal(submitted.length, 0);
});

test("password reset forwards the nonce and password only after local validation and consumes success", async () => {
  const { client, submitted } = fixture();
  await client.requestPasswordReset("13800000000");
  await assert.rejects(client.requestPasswordReset("13800000000", "12", "TestPass123"), {
    code: "account_verification_invalid",
  });
  await assert.rejects(client.requestPasswordReset("13800000000", "123456", "short"), {
    code: "account_password_weak",
  });
  assert.equal(submitted.length, 0);
  await client.requestPasswordReset("13800000000", "123456", "TestPass123");
  assert.deepEqual(submitted, [{ nonce: "123456", password: "TestPass123" }]);
  await assert.rejects(client.requestPasswordReset("13800000000", "123456", "TestPass123"), {
    code: "account_verification_expired",
  });
});

test("provider verification failure never becomes success and permits a corrected code", async () => {
  const { client, fail, submitted } = fixture();
  await client.requestPasswordReset("13800000000");
  fail(true);
  await assert.rejects(client.requestPasswordReset("13800000000", "000000", "TestPass123"));
  fail(false);
  await client.requestPasswordReset("13800000000", "123456", "TestPass123");
  assert.equal(submitted.length, 2);
});
