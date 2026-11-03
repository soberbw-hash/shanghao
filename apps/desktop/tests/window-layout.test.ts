import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fitMainWindow, normalizeSavedWindowBounds } from "../src/main/window-layout";

test("invalid persisted geometry cannot crash window startup or reach Electron bounds", () => {
  for (const value of [null, [], "bad", 1, false])
    assert.deepEqual(normalizeSavedWindowBounds(value), {});
  assert.deepEqual(
    normalizeSavedWindowBounds({ x: -100, y: Infinity, width: "1600", height: -2 }),
    { x: -100 },
  );
  assert.deepEqual(normalizeSavedWindowBounds({ x: 15.2, y: 0, width: 1280, height: 800 }), {
    x: 15,
    y: 0,
    width: 1280,
    height: 800,
  });
});

test("DPI-scaled work areas get an inset window without scaling dimensions twice", () => {
  for (const work of [
    { x: 0, y: 0, width: 1707, height: 920 }, // 2560x1440 at 150%
    { x: 0, y: 0, width: 1920, height: 1040 }, // 4K at 200%
    { x: 0, y: 0, width: 1920, height: 1040 }, // 1080p at 100%
  ]) {
    const bounds = fitMainWindow(work, {});
    assert.ok(bounds.width < work.width && bounds.height < work.height);
    assert.ok(bounds.x >= work.x && bounds.y >= work.y);
    assert.ok(bounds.x + bounds.width <= work.x + work.width);
    assert.ok(bounds.y + bounds.height <= work.y + work.height);
  }
});

test("saved bounds survive when valid; oversized or invalid bounds fit the current display", () => {
  const work = { x: -1707, y: 0, width: 1707, height: 920 };
  const saved = { x: -1600, y: 30, width: 1300, height: 780 };
  assert.deepEqual(fitMainWindow(work, saved), { ...saved, minWidth: 1120, minHeight: 720 });
  const fitted = fitMainWindow(work, { x: NaN, y: Infinity, width: 2500, height: 1500 });
  assert.ok(fitted.width < work.width && fitted.height < work.height);
  assert.ok(fitted.x >= work.x && fitted.x + fitted.width <= work.x + work.width);
  const small = fitMainWindow({ x: 0, y: 0, width: 900, height: 500 }, {});
  assert.equal(small.minWidth, 900);
  assert.equal(small.minHeight, 500);
});
