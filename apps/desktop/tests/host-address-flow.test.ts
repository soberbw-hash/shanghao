import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourcePath = path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts");

test("host uses local loopback only for self-connect, not for outward invite links", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("connectUrl: hostJoinUrl"), true);
  assert.equal(source.includes("inviteUrl: session.signalingUrl"), true);
  assert.equal(source.includes("signalingUrl: inviteUrl || undefined"), true);
  assert.equal(source.includes("const inviteUrl = hostSession?.signalingUrl || room.signalingUrl;"), true);
});
