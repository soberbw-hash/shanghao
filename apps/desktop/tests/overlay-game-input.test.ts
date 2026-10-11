import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as bounds from "../src/main/overlay-bounds";

const source = ts.transpileModule(
  readFileSync(new URL("../src/main/overlay-window.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
const harness = (platform = "win32", failCreate = false) => {
  const calls: string[] = [];
  const modes: { ignore: boolean; forward: boolean }[] = [];
  const timers = new Set<() => void>();
  const events = new Map<string, () => void>();
  const messages: unknown[][] = [];
  let point = { x: 10, y: 530 };
  let now = 0;
  let parent: unknown;
  let ownerOptions: Record<string, unknown> | undefined;
  const owner = {
    destroyed: false,
    isDestroyed: () => owner.destroyed,
    destroy: () => {
      owner.destroyed = true;
    },
  };
  const window = {
    destroyed: false,
    isDestroyed: () => window.destroyed,
    isVisible: () => true,
    getBounds: () => ({ x: 6, y: 517, width: 142, height: 46 }),
    setAlwaysOnTop: () => calls.push("top"),
    isAlwaysOnTop: () => true,
    moveTop: () => calls.push("moveTop"),
    showInactive: () => {
      calls.push("showInactive");
      events.get("show")?.();
    },
    setSkipTaskbar: (skip: boolean) => calls.push(`skipTaskbar:${skip}`),
    setVisibleOnAllWorkspaces: () => undefined,
    setMovable: () => undefined,
    setIgnoreMouseEvents: (ignore: boolean, options: { forward: boolean }) =>
      modes.push({ ignore, ...options }),
    on: (event: string, callback: () => void) => events.set(event, callback),
    loadURL: async () => undefined,
    setPosition: () => undefined,
    destroy: () => {
      window.destroyed = true;
      events.get("closed")?.();
    },
    webContents: {
      once: (event: string, callback: () => void) => events.set(event, callback),
      setZoomFactor: () => undefined,
      isLoading: () => false,
    },
  };
  const module = {
    exports: {} as {
      OverlayWindowController: new () => {
        show: () => boolean;
        close: () => void;
        setGameActive: (active: boolean) => void;
        setInteractive: (active: boolean) => void;
      };
    },
  };
  runInNewContext(source, {
    exports: module.exports,
    __dirname: "isolated-test",
    process: { env: {}, platform },
    Date: class extends Date {
      static now() {
        now += 2500;
        return now;
      }
    },
    setInterval: (callback: () => void) => {
      timers.add(callback);
      return callback;
    },
    clearInterval: (callback: () => void) => timers.delete(callback),
    clearTimeout: () => undefined,
    require: (id: string) => {
      if (id === "node:path") return path;
      if (id === "node:fs") return { existsSync: () => false };
      if (id === "node:fs/promises") return { writeFile: async () => undefined };
      if (id === "electron")
        return {
          app: {
            getPath: () => "isolated-test",
            getAppPath: () => "isolated-test",
            isPackaged: false,
          },
          BaseWindow: class {
            constructor(options: Record<string, unknown>) {
              ownerOptions = options;
              return owner;
            }
          },
          BrowserWindow: class {
            constructor(options: { parent?: unknown }) {
              if (failCreate) throw new Error("creation failed");
              parent = options.parent;
              return window;
            }
          },
          screen: {
            getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
            getCursorScreenPoint: () => {
              calls.push("cursor");
              return point;
            },
          },
        };
      if (id === "@private-voice/shared")
        return { IPC_CHANNELS: { overlay: { hoverState: "hover", state: "state" } } };
      if (id === "./overlay-bounds") return bounds;
      if (id === "./platform/PlatformService")
        return { platformService: { isWindows: platform === "win32" } };
      if (id === "./safe-web-contents")
        return { sendToWindow: (...args: unknown[]) => messages.push(args) };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  const controller = new module.exports.OverlayWindowController();
  return {
    controller,
    calls,
    modes,
    timers,
    messages,
    owner,
    ownerOptions: () => ownerOptions,
    parent: () => parent,
    load: () => events.get("did-finish-load")!(),
    outside: () => {
      point = { x: 500, y: 500 };
    },
  };
};

test("an active game keeps the overlay passive without cursor polling or periodic Z-order writes", () => {
  const state = harness();
  state.controller.setGameActive(true);
  state.controller.show();
  state.load();
  state.controller.setInteractive(true);
  assert.equal(state.timers.size, 0);
  assert.deepEqual(state.modes.at(-1), { ignore: true, forward: false });
  assert.equal(state.calls.includes("cursor"), false);
  assert.equal(state.calls.includes("moveTop"), false);
  state.controller.close();
});

test("Windows overlays use a hidden renderer-free owner and hide their taskbar tab after showing", () => {
  const state = harness();
  state.controller.show();
  assert.equal(state.parent(), state.owner);
  assert.equal(state.ownerOptions()?.show, false);
  assert.equal(state.ownerOptions()?.focusable, false);
  assert.equal(state.ownerOptions()?.skipTaskbar, true);
  state.load();
  assert.ok(state.calls.indexOf("skipTaskbar:true") > state.calls.indexOf("showInactive"));
  state.controller.close();
  assert.equal(state.owner.destroyed, true);
});

test("overlay creation failure releases its hidden owner", () => {
  const state = harness("win32", true);
  assert.throws(() => state.controller.show(), /creation failed/);
  assert.equal(state.owner.destroyed, true);
});

test("other platforms do not create a Windows taskbar owner", () => {
  const state = harness("darwin");
  state.controller.show();
  state.load();
  assert.equal(state.parent(), undefined);
  assert.equal(state.ownerOptions(), undefined);
  state.controller.close();
});

test("entering a game releases hover interaction and late renderer requests cannot capture input", () => {
  const state = harness();
  state.controller.show();
  state.load();
  assert.equal(state.modes.at(-1)?.ignore, false);
  state.controller.setGameActive(true);
  state.controller.setInteractive(true);
  assert.deepEqual(state.modes.at(-1), { ignore: true, forward: false });
  assert.equal(state.timers.size, 0);
  state.outside();
  state.controller.setGameActive(false);
  assert.equal(state.timers.size, 1);
  assert.deepEqual(state.modes.at(-1), { ignore: true, forward: true });
  state.controller.close();
  assert.equal(state.timers.size, 0);
});

test("ordinary hover does not repeatedly reorder native windows", () => {
  const state = harness();
  state.controller.show();
  state.load();
  state.calls.length = 0;
  for (let i = 0; i < 100; i += 1) for (const tick of state.timers) tick();
  assert.equal(state.calls.includes("top"), false);
  assert.equal(state.calls.includes("moveTop"), false);
  state.controller.close();
});

test("closing an overlay before load cannot later show it or start its polling", () => {
  const state = harness();
  state.controller.show();
  state.controller.close();
  state.calls.length = 0;
  state.load();
  assert.deepEqual(state.calls, []);
  assert.equal(state.timers.size, 0);
});
