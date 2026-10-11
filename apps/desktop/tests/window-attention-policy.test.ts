import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const ipc = readFileSync(new URL("../src/main/ipc.ts", import.meta.url), "utf8");
const attentionSource = ts.transpileModule(
  `${ipc.slice(ipc.indexOf("let attentionResetTimer:"), ipc.indexOf("const sanitizeServerUrl"))}\nexport { bringWindowToFront, shakeMainWindow };`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const attentionHarness = () => {
  const calls: string[] = [];
  const timeouts = new Set<() => void>();
  const intervals = new Set<() => void>();
  let focused = false;
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => false,
    isFocused: () => focused,
    isFullScreen: () => false,
    isMaximized: () => false,
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
    restore: () => calls.push("restore"),
    moveTop: () => calls.push("moveTop"),
    isAlwaysOnTop: () => false,
    setAlwaysOnTop: (active: boolean) => calls.push(`top:${active}`),
    flashFrame: (active: boolean) => calls.push(`flash:${active}`),
    setPosition: () => calls.push("move"),
  };
  const module = {
    exports: {} as {
      bringWindowToFront: (window: object, attention?: boolean) => void;
      shakeMainWindow: (window: object) => void;
    },
  };
  runInNewContext(attentionSource, {
    exports: module.exports,
    setTimeout: (callback: () => void) => {
      timeouts.add(callback);
      return callback;
    },
    clearTimeout: (callback: () => void) => timeouts.delete(callback),
    setInterval: (callback: () => void) => {
      intervals.add(callback);
      return callback;
    },
    clearInterval: (callback: () => void) => intervals.delete(callback),
  });
  return {
    ...module.exports,
    window,
    calls,
    timeouts,
    intervals,
    focus: () => {
      focused = true;
    },
  };
};

test("an intentional knock retains its foreground alert and resets temporary topmost state", () => {
  const state = attentionHarness();
  state.bringWindowToFront(state.window, true);
  assert.deepEqual(state.calls, ["restore", "show", "moveTop", "focus", "top:true", "flash:true"]);
  assert.equal(state.intervals.size, 0);
  for (const finish of state.timeouts) finish();
  assert.deepEqual(state.calls.slice(-2), ["flash:false", "top:false"]);
});

test("explicit notification click still restores and opens the main window", () => {
  const state = attentionHarness();
  state.bringWindowToFront(state.window);
  assert.deepEqual(state.calls, ["restore", "show", "moveTop", "focus"]);
});

test("opening a window explicitly does not start a background attention timer", () => {
  const state = attentionHarness();
  state.focus();
  state.bringWindowToFront(state.window);
  assert.equal(state.timeouts.size, 0);
});

const mainSource = readFileSync(new URL("../src/main/window.ts", import.meta.url), "utf8");
test("window visibility diagnostics are bounded and only contain window state", () => {
  let now = 1;
  const events = new Map<string, () => void>();
  const logs: { event: string; visible: boolean; focused: boolean; minimized: boolean }[] = [];
  const source = ts.transpileModule(
    mainSource.slice(
      mainSource.indexOf("  let visibilityLogWindow"),
      mainSource.indexOf("  let canRevealAtStartup"),
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  runInNewContext(source, {
    Date: { now: () => now },
    log: (_level: string, _message: string, context: (typeof logs)[number]) => logs.push(context),
    window: {
      on: (event: string, callback: () => void) => events.set(event, callback),
      isDestroyed: () => false,
      isVisible: () => true,
      isFocused: () => false,
      isMinimized: () => false,
    },
  });
  for (let i = 0; i < 100; i += 1) events.get("focus")!();
  assert.equal(logs.length, 32);
  assert.equal(
    JSON.stringify(logs[0]),
    JSON.stringify({ event: "focus", visible: true, focused: false, minimized: false }),
  );
  now = 60_001;
  events.get("hide")!();
  assert.equal(logs.length, 33);
});

const startupHarness = () => {
  const calls: string[] = [];
  const events = new Map<string, () => void>();
  let destroyed = false;
  const window = {
    isDestroyed: () => destroyed,
    on: (event: string, callback: () => void) => events.set(event, callback),
    showInactive: () => calls.push("showInactive"),
  };
  const module = { exports: {} as { revealAtStartup: () => void } };
  const source = ts.transpileModule(
    `${mainSource.slice(mainSource.indexOf("  let canRevealAtStartup"), mainSource.indexOf("  const loadFallback"))}\nexport { revealAtStartup };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  runInNewContext(source, { exports: module.exports, window });
  return {
    ...module.exports,
    calls,
    events,
    destroy: () => {
      destroyed = true;
    },
  };
};

test("late startup readiness and timeout cannot reopen a hidden or minimized window", () => {
  for (const event of ["hide", "minimize"]) {
    const state = startupHarness();
    state.events.get(event)!();
    state.revealAtStartup();
    assert.deepEqual(state.calls, [], event);
  }
  const state = startupHarness();
  state.revealAtStartup();
  state.revealAtStartup();
  assert.deepEqual(state.calls, ["showInactive"]);
  state.destroy();
  state.revealAtStartup();
  assert.deepEqual(state.calls, ["showInactive"]);
});

test("fallback loading never shows or focuses the main window", () => {
  const fallback = mainSource.slice(
    mainSource.indexOf("  const loadFallback"),
    mainSource.indexOf("  const loadRenderer"),
  );
  assert.match(fallback, /await window\.loadURL/);
  assert.doesNotMatch(fallback, /window\.(show|showInactive|focus|restore|moveTop)\(/);
  const ready = mainSource.slice(
    mainSource.indexOf('window.once("ready-to-show"'),
    mainSource.indexOf(
      "window.webContents.setWindowOpenHandler",
      mainSource.indexOf('window.once("ready-to-show"'),
    ),
  );
  assert.match(ready, /revealAtStartup\(\)/);
  assert.match(mainSource, /setTimeout\(\(\) => \{\s*revealAtStartup\(\);\s*\}, 1_500\)/);
});

test("game detection drives overlay pass-through independently of shortcut configuration", () => {
  const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const callback = index.slice(
    index.indexOf("gameDetection.onDetected"),
    index.indexOf("const usesInjectedCapturePresence"),
  );
  assert.match(callback, /overlay\.setGameActive\(Boolean\(snapshot\.gameName\)\)/);
});
