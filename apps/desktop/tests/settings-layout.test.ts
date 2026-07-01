import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const audioCardPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/settings/AudioSettingsCard.tsx",
);
const settingsPagePath = path.resolve(process.cwd(), "src/renderer/src/pages/SettingsPage.tsx");
const homePagePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");

test("appearance settings no longer expose fixed prompt sound toggles", () => {
  const source = readFileSync(settingsPagePath, "utf8");

  assert.equal(source.includes("开麦提示音"), false);
  assert.equal(source.includes("关麦提示音"), false);
  assert.equal(source.includes("成员进入提示音"), false);
  assert.equal(source.includes("成员退出提示音"), false);
  assert.equal(source.includes("连接成功"), false);
  assert.equal(source.includes("界面提示音"), true);
  assert.equal(source.includes("关闭窗口时留在后台"), true);
});

test("home page exposes only the fixed channel server address entry", () => {
  const source = readFileSync(homePagePath, "utf8");

  assert.equal(source.includes("服务器地址"), true);
  assert.equal(source.includes("进入频道"), true);
  assert.equal(source.includes("自动复制开房地址"), false);
  assert.equal(source.includes("连接模式"), false);
  assert.equal(source.includes("开启房间"), false);
});

test("advanced audio settings are collapsed by default", () => {
  const source = readFileSync(audioCardPath, "utf8");

  assert.equal(source.includes("高级音频"), true);
  assert.equal(source.includes("一般不需要修改"), true);
  assert.equal(source.includes("isAdvancedOpen ?"), true);
  assert.equal(source.includes('value: "32000"'), true);
  assert.equal(source.includes("五段声音塑形"), true);
  assert.equal(source.includes("低切滤波"), true);
  assert.equal(source.includes("thresholdDraft"), true);
  assert.equal(source.includes("equalizerDraft"), true);
});

test("settings keep only everyday voice controls and remove advanced connection", () => {
  const source = readFileSync(settingsPagePath, "utf8");

  for (const label of ["语音", "通知", "更新", "诊断"]) {
    assert.equal(source.includes(label), true);
  }
  assert.equal(source.includes('id: "recording"'), false);
  for (const removed of ["资料", "悬浮小窗", "高级连接", "NetworkSettingsCard", "ProfileSettingsCard"]) {
    assert.equal(source.includes(removed), false);
  }
  assert.equal(source.includes('useState<SettingsSectionId>("audio")'), true);
});
