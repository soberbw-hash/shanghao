import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isValidCloudBaseUsername } from "../src/common/cloudbase-username";
import {
  CloudBaseAccountClient,
  type CloudBaseAccountAuth,
  type CloudBaseAccountDiagnostic,
} from "../src/main/cloudbase-account";
import { accountErrorMessage } from "../src/renderer/src/features/account/accountMessages";

const registration = {
  username: "sober1",
  displayName: "Sober",
  phone: "13800000000",
  verificationCode: "123456",
  password: "TestPassword123",
};

const makeClient = (signupResult: unknown = {}) => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const diagnostics: CloudBaseAccountDiagnostic[] = [];
  const auth = {
    async getVerification(input: unknown) {
      calls.push({ method: "getVerification", input });
      return { verification_id: "test-verification-id", is_user: false };
    },
    async verify(input: unknown) {
      calls.push({ method: "verify", input });
      return { verification_token: "test-verification-token" };
    },
    async signUp(input: unknown) {
      calls.push({ method: "signUp", input });
      return signupResult;
    },
    async signIn(input: unknown) {
      calls.push({ method: "signIn", input });
      return {};
    },
    async getCurrentUser() {
      return { uid: "test-user-id", username: "sober1", name: "Sober" };
    },
    async getCredentials() {
      return { access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 };
    },
  } as unknown as CloudBaseAccountAuth;
  const client = new CloudBaseAccountClient(
    { envId: "test-env", region: "ap-shanghai", publishableKey: "test-publishable-key" },
    { auth, onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
  );
  return { client, calls, diagnostics };
};

test("traditional CloudBase signup matches the live endpoint's lowercase 6–25 rule", () => {
  for (const value of ["sober1", "a12345", "abc_de", "abc-de", "abcde_", "a".repeat(25)]) {
    assert.equal(isValidCloudBaseUsername(value), true, value);
  }
  for (const value of [
    "",
    "Sober",
    "sober",
    "Sober1",
    "123456",
    "1sober",
    "_sober",
    "a".repeat(26),
    "测试用户名字",
    "ab cde",
  ]) {
    assert.equal(isValidCloudBaseUsername(value), false, value);
  }
  assert.equal(isValidCloudBaseUsername("  sober1  "), true);
});

test("reject unsupported names before consuming a verification code, without renaming", async () => {
  const { client, calls } = makeClient();
  await client.requestVerificationCode(registration.phone);
  for (const username of ["Sober", "sober", "Sober1"]) {
    await assert.rejects(client.registerByPhone({ ...registration, username }), {
      code: "account_username_invalid",
    });
  }
  assert.deepEqual(
    calls.map((call) => call.method),
    ["getVerification"],
  );
});

test("verified signup preserves the chosen username and display name and reads CloudBase session", async () => {
  const { client, calls } = makeClient();
  await client.requestVerificationCode(registration.phone);
  const result = await client.registerByPhone(registration);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["getVerification", "verify", "signUp"],
  );
  assert.deepEqual(calls[2]?.input, {
    phone_number: "+86 13800000000",
    verification_code: registration.verificationCode,
    verification_token: "test-verification-token",
    username: "sober1",
    password: registration.password,
    name: "Sober",
  });
  assert.equal(result.profile.displayName, "Sober");
  assert.equal(result.profile.username, "sober1");
  assert.equal(result.session.provider, "cloudbase");
  assert.equal(result.session.accessToken, "test-access");
});

test("phone password login uses CloudBase's country-code format", async () => {
  const { client, calls } = makeClient();
  const result = await client.login("13800000000", registration.password);

  assert.deepEqual(calls[0], {
    method: "signIn",
    input: { username: "+86 13800000000", password: registration.password },
  });
  assert.equal(result.profile.userId, "test-user-id");
});

test("both OAuth error envelopes keep descriptions for classification, never user output or logs", async () => {
  for (const nested of [false, true]) {
    const providerError = {
      error: "invalid_argument",
      error_description:
        'invalid SignUpRequest.Username: value does not match regex pattern "^$|^[a-z][0-9a-z_-]{5,24}$"',
      request_id: "dfc15557f3ee4c96a871ef2be4958010",
    };
    const { client, diagnostics } = makeClient(nested ? { error: providerError } : providerError);
    await client.requestVerificationCode(registration.phone);
    await assert.rejects(client.registerByPhone(registration), {
      code: "account_username_invalid",
    });
    assert.equal(diagnostics[0]?.stage, "sign_up");
    assert.equal(diagnostics[0]?.providerCode, "invalid_argument");
    assert.equal(JSON.stringify(diagnostics).includes("SignUpRequest"), false);
    const message = accountErrorMessage("account_username_invalid");
    assert.match(message, /6～25/);
    assert.match(message, /小写/);
    assert.doesNotMatch(message, /1～32|支持大小写|SignUpRequest|regex/);
  }
});

test("password rejection is not mistaken for a username problem", async () => {
  const { client } = makeClient({
    error: "invalid_argument",
    error_description:
      "invalid SignUpRequest.Password: password policy requires letters and numbers",
  });
  await client.requestVerificationCode(registration.phone);
  await assert.rejects(client.registerByPhone(registration), { code: "account_password_weak" });
});

test("SMS action and submit use the same username guard before issuing requests", async () => {
  const source = await readFile(
    new URL("../src/renderer/src/pages/AccountPage.tsx", import.meta.url),
    "utf8",
  );
  const smsAction = source.slice(source.indexOf('className="account-code-action"'));
  assert.match(
    smsAction,
    /if \(!isValidCloudBaseUsername\(username\)\) \{[\s\S]*?return;[\s\S]*?requestVerificationCode\(phone\.trim\(\)\)/,
  );
  assert.match(
    source,
    /if \(!isValidCloudBaseUsername\(username\)\) \{[\s\S]*?return;[\s\S]*?await register\(/,
  );
  assert.doesNotMatch(source, /CLOUD_BASE_USERNAME_PATTERN|1～32 位，支持大小写/);
});
