import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");

test("home page keeps chat panel and does not render mic test on the main screen", () => {
  const source = readFileSync(root, "utf8");

  assert.equal(source.includes("临时聊天"), true);
  assert.equal(source.includes("开始试音"), false);
  assert.equal(source.includes("BrandMark"), false);
});

test("home page removes the redundant connection settings button", () => {
  const source = readFileSync(root, "utf8");

  assert.equal(source.includes("连接设置"), false);
});

test("home page pins host and join actions to a stable bottom row", () => {
  const source = readFileSync(root, "utf8");
  const pinnedActionRows = source.match(/mt-auto flex items-end gap-3 pt-5/g) ?? [];

  assert.equal(pinnedActionRows.length >= 2, true);
});
