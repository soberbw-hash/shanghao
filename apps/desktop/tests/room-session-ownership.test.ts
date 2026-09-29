import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  finishOwnedRoomCleanup,
  RoomSessionOwnership,
} from "../src/renderer/src/features/room/sessionOwnership";

test("a late old-room disconnect cannot clear a newer room", async () => {
  const ownership = new RoomSessionOwnership();
  const oldGeneration = ownership.advance();
  let finishRelease: (() => void) | undefined;
  let cleared = false;
  const release = new Promise<void>((resolve) => {
    finishRelease = resolve;
  });
  const cleanup = finishOwnedRoomCleanup(
    ownership,
    oldGeneration,
    () => release,
    () => {
      cleared = true;
    },
  );
  const newGeneration = ownership.advance();
  finishRelease!();
  await cleanup;
  assert.equal(ownership.owns(oldGeneration), false);
  assert.equal(ownership.owns(newGeneration), true);
  assert.equal(cleared, false);
});

test("invalid join parameters cannot revoke the current room session", () => {
  const source = readFileSync(
    new URL("../src/renderer/src/hooks/useRoomState.ts", import.meta.url),
    "utf8",
  );
  const join = source.slice(
    source.indexOf("const joinChannel ="),
    source.indexOf("const switchChannel ="),
  );
  const validate = join.indexOf(
    "normalizeServerUrl(serverUrlOverride || currentSettings.relayServerUrl)",
  );
  const takeover = join.indexOf("roomSessionOwnership.advance()");
  assert.ok(validate >= 0 && takeover > validate);
  assert.match(join.slice(validate, takeover), /catch \(error\) \{[\s\S]*?return;/);
});

test("the current room can clear its own state after disconnect", async () => {
  const ownership = new RoomSessionOwnership();
  const generation = ownership.advance();
  let cleared = false;
  await finishOwnedRoomCleanup(
    ownership,
    generation,
    async () => undefined,
    () => {
      cleared = true;
    },
  );
  assert.equal(cleared, true);
});

test("late callbacks from an old peer cannot update the next room", () => {
  const ownership = new RoomSessionOwnership();
  const oldGeneration = ownership.advance();
  let activePeerId = "old-peer";
  let applied = 0;
  const oldCallback = () => {
    if (ownership.ownsPeer(oldGeneration, "old-peer", activePeerId)) applied += 1;
  };
  oldCallback();
  assert.equal(applied, 1);

  ownership.advance();
  activePeerId = "new-peer";
  oldCallback();
  assert.equal(applied, 1);
  assert.equal(ownership.ownsPeer(oldGeneration, "old-peer", "old-peer"), false);
  assert.equal(ownership.ownsPeer(ownership.current(), "new-peer", activePeerId), true);
});

test("room timeline is bounded, expires old entries, and only stores event codes", () => {
  const ownership = new RoomSessionOwnership();
  const generation = ownership.advance();
  const started = Date.parse("2026-09-27T00:00:00.000Z");
  ownership.record("join_requested", generation, started);
  for (let index = 0; index < 130; index += 1) {
    ownership.record("reconnect_attempt", generation, started + index + 1);
  }
  const bounded = ownership.snapshot(started + 131);
  assert.equal(bounded.events.length, 120);
  assert.equal(bounded.droppedEvents, 11);
  assert.equal(bounded.events.at(-1)?.event, "reconnect_attempt");
  assert.equal(JSON.stringify(bounded).includes("private speech"), false);

  const expired = ownership.snapshot(started + 11 * 60_000);
  assert.equal(expired.events.length, 0);
  assert.equal(expired.droppedEvents, 131);
});

test("microphone replacement revokes old detector ownership and commits before cleanup", () => {
  const source = readFileSync(
    new URL("../src/renderer/src/hooks/useRoomState.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /activeSpeakingDetector = null;\s*previousDetector\?\.destroy\(\)/);
  const replacement = source.slice(source.indexOf("const replaceInputDevice ="));
  assert.match(
    replacement,
    /activeProcessedMicrophone = processedMicrophone;[\s\S]*?pendingProcessor = undefined;[\s\S]*?previousProcessor\?\.dispose\(\)/,
  );
  assert.match(replacement, /try \{\s*startSpeakingDetector\(stream\);\s*\} catch/);
});

test("every RoomClient callback checks the owning session before changing view state", () => {
  const source = readFileSync(
    new URL("../src/renderer/src/hooks/useRoomState.ts", import.meta.url),
    "utf8",
  );
  const file = ts.createSourceFile("useRoomState.ts", source, ts.ScriptTarget.Latest, true);
  const callbacks: ts.PropertyAssignment[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(file) === "RoomClient" &&
      node.arguments?.[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      callbacks.push(
        ...node.arguments[0].properties.filter(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && property.name.getText(file).startsWith("on"),
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(callbacks.length >= 20);
  assert.deepEqual(
    callbacks
      .filter((callback) => !callback.initializer.getText(file).includes("isCurrentSession()"))
      .map((callback) => callback.name.getText(file)),
    [],
  );
});
