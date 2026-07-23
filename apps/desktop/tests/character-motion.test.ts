import assert from "node:assert/strict";
import test from "node:test";

import {
  planCharacterRoute,
  sceneEntryPoint,
} from "../src/renderer/src/features/voice-scene/characterMotion";
import { characterPositions } from "../src/renderer/src/features/voice-scene/sceneZones";

test("same-row seat changes stay horizontal and last at least one second", () => {
  const route = planCharacterRoute({
    kind: "move",
    from: characterPositions.gameDesk1,
    to: characterPositions.gameDesk2,
    fromZone: "gameDesk1",
    toZone: "gameDesk2",
  });

  assert.deepEqual(route.points, [characterPositions.gameDesk1, characterPositions.gameDesk2]);
  assert.equal(route.duration >= 1, true);
  assert.equal(route.duration <= 1.3, true);
  assert.equal(route.direction, "right");
});

test("an unobstructed cross-row seat change stays direct", () => {
  const route = planCharacterRoute({
    kind: "move",
    from: characterPositions.gameDesk2,
    to: characterPositions.gameDesk4,
    fromZone: "gameDesk2",
    toZone: "gameDesk4",
  });

  assert.deepEqual(route.points, [characterPositions.gameDesk2, characterPositions.gameDesk4]);
  assert.equal(
    route.length,
    Math.hypot(
      characterPositions.gameDesk4.left - characterPositions.gameDesk2.left,
      characterPositions.gameDesk4.top - characterPositions.gameDesk2.top,
    ),
  );
  assert.equal(route.times[0], 0);
  assert.equal(route.times.at(-1), 1);
});

test("a desk-blocked seat change uses the shortest visible detour", () => {
  const route = planCharacterRoute({
    kind: "move",
    from: characterPositions.gameDesk1,
    to: characterPositions.gameDesk3,
    fromZone: "gameDesk1",
    toZone: "gameDesk3",
  });

  assert.equal(route.points.length, 4);
  assert.deepEqual(route.points[0], characterPositions.gameDesk1);
  assert.deepEqual(route.points.at(-1), characterPositions.gameDesk3);
  assert.equal(route.points[1]!.top > characterPositions.gameDesk2.top, true);
  assert.equal(route.points[2]!.top > characterPositions.gameDesk2.top, true);
  assert.equal(route.length > 44, true);
  assert.equal(new Set(route.points.map((point) => `${point.left}:${point.top}`)).size, 4);
  assert.equal(
    route.times.every((time, index) => index === 0 || time > route.times[index - 1]!),
    true,
  );
});

test("channel entry always begins at the left-side entrance", () => {
  const destination = characterPositions.gameDesk5;
  const route = planCharacterRoute({
    kind: "enter",
    from: sceneEntryPoint(),
    to: destination,
    toZone: "gameDesk5",
  });

  assert.deepEqual(route.points[0], { left: -9, top: 56 });
  assert.deepEqual(route.points.at(-1), destination);
  assert.equal(route.duration >= 1.5, true);
  assert.equal(route.direction, "right");
});

test("away and exit routes use only the shortest required desk detour", () => {
  const awayRoute = planCharacterRoute({
    kind: "move",
    from: characterPositions.gameDesk2,
    to: characterPositions.restroomZone,
    fromZone: "gameDesk2",
    toZone: "restroomZone",
  });
  assert.equal(awayRoute.points.length, 3);
  assert.deepEqual(awayRoute.points[0], characterPositions.gameDesk2);
  assert.deepEqual(awayRoute.points.at(-1), characterPositions.restroomZone);

  const exitRoute = planCharacterRoute({
    kind: "exit",
    from: characterPositions.restroomZone,
    to: sceneEntryPoint(),
    fromZone: "restroomZone",
  });
  assert.deepEqual(exitRoute.points, [characterPositions.restroomZone, { left: -9, top: 56 }]);
});

test("an interrupted route can leave the footprint it currently occupies", () => {
  const interruptedPoint = { left: 38, top: 40 };
  const route = planCharacterRoute({
    kind: "move",
    from: interruptedPoint,
    to: characterPositions.gameDesk5,
    toZone: "gameDesk5",
  });

  assert.deepEqual(route.points[0], interruptedPoint);
  assert.deepEqual(route.points.at(-1), characterPositions.gameDesk5);
  assert.equal(route.times[0], 0);
  assert.equal(route.times.at(-1), 1);
});
