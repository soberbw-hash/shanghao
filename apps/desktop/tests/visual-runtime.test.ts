import assert from "node:assert/strict";
import test from "node:test";

import { DisplayRefreshRateService } from "../src/renderer/src/features/visual-runtime/DisplayRefreshRateService";
import { RoomAnimationScheduler } from "../src/renderer/src/features/visual-runtime/RoomAnimationScheduler";
import { VisualRuntimeController } from "../src/renderer/src/features/visual-runtime/VisualRuntimeController";
import {
  SceneFeatureRegistry,
  builtInCharacterPackManifest,
  defaultRoomSceneManifest,
  sceneFeatureRegistry,
} from "../src/renderer/src/features/visual-runtime/sceneFeatureRegistry";

const feedFrames = (service: DisplayRefreshRateService, rate: number, count = 90) => {
  for (let index = 0; index < count; index += 1) {
    service.observeFrame((index * 1_000) / rate);
  }
};

test("display refresh sampling reports actual 60, 120 and 144 Hz cadence", () => {
  for (const expected of [60, 120, 144]) {
    const service = new DisplayRefreshRateService();
    feedFrames(service, expected);
    assert.equal(service.getRefreshRateHz(), expected);
    assert.ok(Math.abs(service.getFrameBudgetMs() - 1_000 / expected) < 0.01);
  }
});

test("display environment changes reset stale cadence and retain DPI diagnostics", () => {
  const service = new DisplayRefreshRateService();
  service.updateEnvironment({
    width: 1_920,
    height: 1_080,
    availableWidth: 1_920,
    availableHeight: 1_040,
    scaleFactor: 1,
  });
  feedFrames(service, 60);
  assert.equal(service.getRefreshRateHz(), 60);
  service.updateEnvironment({
    width: 2_560,
    height: 1_440,
    availableWidth: 2_560,
    availableHeight: 1_400,
    scaleFactor: 1.25,
  });
  assert.equal(service.getRefreshRateHz(), undefined);
  assert.equal(service.getEnvironment()?.scaleFactor, 1.25);
});

test("visual runtime pauses pure visual frames while hidden and resumes cleanly", () => {
  let visible = true;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  let visibilityListener: (() => void) | undefined;
  const runtime = new VisualRuntimeController(
    {
      requestFrame: (callback) => {
        const id = ++nextId;
        callbacks.set(id, callback);
        return id;
      },
      cancelFrame: (id) => callbacks.delete(id),
      isVisible: () => visible,
      addVisibilityListener: (listener) => {
        visibilityListener = listener;
      },
      removeVisibilityListener: (listener) => {
        if (visibilityListener === listener) visibilityListener = undefined;
      },
    },
    new DisplayRefreshRateService(),
  );
  let frames = 0;
  const visibilityStates: boolean[] = [];
  runtime.subscribeVisibility((next) => visibilityStates.push(next));
  runtime.registerTask("test", () => {
    frames += 1;
  });
  runtime.start();
  assert.equal(callbacks.size, 1);
  const first = [...callbacks.entries()][0];
  assert.ok(first);
  callbacks.delete(first[0]);
  first[1](16.67);
  assert.equal(frames, 1);

  visible = false;
  visibilityListener?.();
  assert.equal(callbacks.size, 0);
  visible = true;
  visibilityListener?.();
  assert.equal(callbacks.size, 1);
  assert.deepEqual(visibilityStates, [true, false, true]);
  runtime.stop();
});

test("visual runtime asset preload cache is reused and bounded", async () => {
  const runtime = new VisualRuntimeController({
    requestFrame: () => 1,
    cancelFrame: () => undefined,
    isVisible: () => true,
    addVisibilityListener: () => undefined,
    removeVisibilityListener: () => undefined,
  });
  let loads = 0;
  const first = runtime.preloadAsset("same", async () => ++loads);
  const second = runtime.preloadAsset("same", async () => ++loads);
  assert.equal(await first, 1);
  assert.equal(await second, 1);
  for (let index = 0; index < 40; index += 1) {
    await runtime.preloadAsset(`asset-${index}`, async () => index);
  }
  assert.equal(runtime.getPreloadedAssetCount(), 32);
});

test("room animation queue coalesces keys, stays bounded and performs one full reconcile", () => {
  let callback: FrameRequestCallback | undefined;
  const runtime = new VisualRuntimeController({
    requestFrame: (next) => {
      callback = next;
      return 1;
    },
    cancelFrame: () => {
      callback = undefined;
    },
    isVisible: () => true,
    addVisibilityListener: () => undefined,
    removeVisibilityListener: () => undefined,
  });
  runtime.start();
  let writes = 0;
  let reconciles = 0;
  const scheduler = new RoomAnimationScheduler(runtime, 2, () => {
    reconciles += 1;
  });
  scheduler.enqueue({ key: "same", write: () => (writes += 1) });
  scheduler.enqueue({ key: "same", write: () => (writes += 10) });
  assert.equal(scheduler.snapshot().pending, 1);
  scheduler.enqueue({ key: "second", write: () => (writes += 100) });
  scheduler.enqueue({ key: "overflow", write: () => (writes += 1_000) });
  assert.equal(scheduler.snapshot().pending, 2);
  assert.equal(scheduler.snapshot().droppedEvents, 1);
  callback?.(8.33);
  assert.equal(reconciles, 1);
  assert.equal(writes, 0);
  assert.equal(scheduler.snapshot().pending, 0);
  runtime.stop();
});

test("scene registry keeps built-ins explicit and rejects unsafe realtime pausing", () => {
  assert.deepEqual(defaultRoomSceneManifest.composition["wall-center"], ["date-calendar"]);
  assert.equal(sceneFeatureRegistry.list("presence")[0]?.id, "characters");
  assert.equal(builtInCharacterPackManifest.rendererType, "layered");
  assert.equal(builtInCharacterPackManifest.states.walk, "walk");
  assert.equal(builtInCharacterPackManifest.transformOrigin, "50% 100%");

  const registry = new SceneFeatureRegistry();
  registry.register({
    id: "chat",
    version: 1,
    type: "communication",
    visual: true,
    interactive: true,
    audio: false,
    network: true,
    backgroundAllowed: true,
    heavyResource: false,
    privacySensitive: true,
    defaultSlot: "overlay",
    pausableWhenHidden: false,
    requiresRealtime: true,
    dataRate: "realtime",
    capabilities: ["chat-data"],
    visualPriority: "realtime",
  });
  assert.throws(() =>
    registry.register({
      id: "chat",
      version: 1,
      type: "communication",
      visual: true,
      interactive: true,
      audio: false,
      network: true,
      backgroundAllowed: true,
      heavyResource: false,
      privacySensitive: true,
      defaultSlot: "overlay",
      pausableWhenHidden: false,
      requiresRealtime: true,
      dataRate: "realtime",
      capabilities: ["chat-data"],
      visualPriority: "realtime",
    }),
  );
  assert.throws(() =>
    registry.register({
      id: "screen-share",
      version: 1,
      type: "capture",
      visual: true,
      interactive: true,
      audio: false,
      network: true,
      backgroundAllowed: true,
      heavyResource: true,
      privacySensitive: true,
      defaultSlot: "overlay",
      pausableWhenHidden: true,
      requiresRealtime: true,
      dataRate: "realtime",
      capabilities: ["screen-capture"],
      visualPriority: "realtime",
    }),
  );
});
