import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const appearanceCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AppearanceSettingsCard.tsx",
);
const networkCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/NetworkSettingsCard.tsx",
);

test("appearance settings no longer expose fixed prompt sound toggles", () => {
  const source = readFileSync(appearanceCardPath, "utf8");

  assert.equal(source.includes("开麦提示音"), false);
  assert.equal(source.includes("关麦提示音"), false);
  assert.equal(source.includes("成员进入提示音"), false);
  assert.equal(source.includes("成员退出提示音"), false);
  assert.equal(source.includes("连接成功"), false);
});

test("network settings no longer expose auto copy invite toggle", () => {
  const source = readFileSync(networkCardPath, "utf8");

  assert.equal(source.includes("自动复制开房地址"), false);
});
