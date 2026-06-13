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
const audioCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AudioSettingsCard.tsx",
);

test("appearance settings no longer expose fixed prompt sound toggles", () => {
  const source = readFileSync(appearanceCardPath, "utf8");

  assert.equal(source.includes("开麦提示音"), false);
  assert.equal(source.includes("关麦提示音"), false);
  assert.equal(source.includes("成员进入提示音"), false);
  assert.equal(source.includes("成员退出提示音"), false);
  assert.equal(source.includes("连接成功"), false);
});

test("network settings provide visible save and connection test feedback", () => {
  const source = readFileSync(networkCardPath, "utf8");

  assert.equal(source.includes("自动复制开房地址"), false);
  assert.equal(source.includes("正在测试…"), true);
  assert.equal(source.includes("服务器可用"), true);
  assert.equal(source.includes("已切换为"), true);
  assert.equal(source.includes("测试地址"), true);
});

test("advanced audio settings are collapsed by default", () => {
  const source = readFileSync(audioCardPath, "utf8");

  assert.equal(source.includes("高级音频"), true);
  assert.equal(source.includes("一般不需要修改"), true);
  assert.equal(source.includes("isAdvancedOpen ?"), true);
});
