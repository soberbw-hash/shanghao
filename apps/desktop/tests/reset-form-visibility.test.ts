import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("reset form exposes code and both password fields before sending a challenge", () => {
  const source = readFileSync("src/renderer/src/pages/AccountPage.tsx", "utf8");
  const start = source.indexOf('className="account-reset-panel"');
  const panel = source.slice(start, source.indexOf("返回登录", start));
  for (const label of ["重置验证码", "新密码", "确认新密码", "确认重置密码"]) {
    assert.ok(panel.includes(label));
  }
  assert.equal(panel.includes("{resetSent ?"), false);
  assert.ok(panel.includes("!resetSent ||"), "completion still requires a sent challenge");
  assert.ok(panel.includes('autoComplete="one-time-code"'));
  assert.equal((panel.match(/autoComplete="new-password"/g) ?? []).length, 2);
});
