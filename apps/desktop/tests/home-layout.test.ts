import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourcePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const memberGridPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/MemberGrid.tsx",
);

test("home page is a full-screen fixed-channel entry page", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("entry-page"), true);
  assert.equal(source.includes("进入开黑频道"), true);
  assert.equal(source.includes("AvatarPicker"), true);
  assert.equal(source.includes("选择角色"), true);
  assert.equal(source.includes("选一个头像"), false);
  assert.equal(source.includes("TemporaryChatPanel"), false);
});

test("home page hides legacy connection mode tabs from the primary flow", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("SegmentedControl"), false);
  assert.equal(source.includes("房主直连"), false);
  assert.equal(source.includes("Tailscale"), false);
  assert.equal(source.includes("joinChannel"), true);
});

test("home page no longer renders a home mic-test panel", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("试音"), false);
  assert.equal(source.includes("麦克风正常"), true);
});

test("member grid stays in a single five-column row instead of wrapping", () => {
  const source = readFileSync(memberGridPath, "utf8");

  assert.equal(source.includes("grid-cols-5"), true);
  assert.equal(source.includes("auto-fit"), false);
});
