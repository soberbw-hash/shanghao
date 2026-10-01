import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  activityZones,
  characterPositions,
  seatSlots,
} from "../src/renderer/src/features/voice-scene/sceneZones";

test("door hit area stays centered and is confined to a small rectangle", () => {
  const door = activityZones.find((zone) => zone.id === "restroomZone")!;
  assert.equal(door.left, 9);
  assert.equal(door.top, 75);
  assert.equal(door.width, 4);
  assert.equal(door.height, 8);
  assert.ok(door.width * door.height < 16 * 30 * 0.1);
  assert.deepEqual(characterPositions.restroomZone, { left: 9, top: 75, zIndex: 38, scale: 0.42 });
  assert.equal(seatSlots.length, 5);
  assert.ok(seatSlots.every((slot) => slot.width === 18 && slot.height === 24));
});

test("door art shrinks by 15 percent without letting its hover label extend the hit area", async () => {
  const css = await readFile(
    new URL("../src/renderer/src/styles/parts/180-room-asset-pass.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.scene-service-restroom \{[^}]*width: 13\.6%;[^}]*height: 25\.5%;/su);
  assert.equal(13.6 / 16, 0.85);
  assert.equal(25.5 / 30, 0.85);
  assert.match(css, /\.scene-zone-hotspot\.activity > span \{\s*pointer-events: none;/u);
});
