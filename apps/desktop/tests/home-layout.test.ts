import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourcePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const memberGridPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/MemberGrid.tsx",
);

test("home page keeps one compact status row and a strict two-card main layout", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes('data-testid="home-status-row"'), true);
  assert.equal(source.includes('data-testid="home-action-card"'), true);
  assert.equal(source.includes('data-testid="home-chat-card"'), true);
  assert.equal(source.includes("xl:grid-cols-2"), true);
});

test("home page keeps host and join action rows pinned to the bottom", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes('data-testid="home-start-actions"'), true);
  assert.equal(source.includes('data-testid="home-join-actions"'), true);
  const pinnedActionRows = source.match(/mt-auto flex items-end gap-3 pt-5/g) ?? [];
  assert.equal(pinnedActionRows.length >= 2, true);
});

test("home page no longer renders a home mic-test panel", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("试音"), false);
  assert.equal(source.includes("临时聊天"), true);
});

test("member grid stays in a single five-column row instead of wrapping", () => {
  const source = readFileSync(memberGridPath, "utf8");

  assert.equal(source.includes("grid-cols-5"), true);
  assert.equal(source.includes("auto-fit"), false);
});
