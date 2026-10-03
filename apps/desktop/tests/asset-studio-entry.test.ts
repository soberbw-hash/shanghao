import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { IPC_CHANNELS } from "@private-voice/shared";

const compile = (name: string) =>
  ts.transpileModule(readFileSync(new URL(`../src/main/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
const fixture = ({
  packaged = true,
  missing = false,
  spawnFails = false,
  shortcutFails = false,
  platform = "win32",
} = {}) => {
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const mainFrame = {};
  const window = { webContents: { mainFrame } };
  const event = { sender: window.webContents, senderFrame: mainFrame };
  const spawns: { file: string; args: string[]; options: unknown }[] = [];
  const shortcuts: { file: string; mode: string; options: { target: string; args: string } }[] = [];
  const exports = {} as { registerAssetStudioIpc: (getWindow: () => unknown) => void };
  runInNewContext(compile("asset-studio-ipc"), {
    exports,
    process: {
      resourcesPath: "C:/fixture/resources",
      execPath: "C:/fixture/ShangHao.exe",
      platform,
    },
    require: (id: string) => {
      if (id === "node:path") return path;
      if (id === "node:fs/promises")
        return {
          access: async () => {
            if (missing) throw Error("missing");
          },
        };
      if (id === "node:child_process")
        return {
          spawn: (file: string, args: string[], options: unknown) => {
            spawns.push({ file, args, options });
            const child = Object.assign(new EventEmitter(), { unref: () => undefined });
            queueMicrotask(() => child.emit(spawnFails ? "error" : "spawn", Error("spawn failed")));
            return child;
          },
        };
      if (id === "@private-voice/shared") return { IPC_CHANNELS };
      if (id === "./platform/PlatformService")
        return { platformService: { isWindows: platform === "win32" } };
      if (id === "electron")
        return {
          app: {
            isPackaged: packaged,
            getAppPath: () => "C:/fixture/project",
            getPath: () => "C:/fixture/Desktop",
          },
          ipcMain: {
            handle: (key: string, fn: (event: unknown) => Promise<void>) => handlers.set(key, fn),
          },
          shell: {
            writeShortcutLink: (
              file: string,
              mode: string,
              options: { target: string; args: string },
            ) => {
              shortcuts.push({ file, mode, options });
              return !shortcutFails;
            },
          },
        };
      throw Error(id);
    },
  });
  exports.registerAssetStudioIpc(() => window);
  return {
    event,
    spawns,
    shortcuts,
    open: (value = event) => handlers.get(IPC_CHANNELS.app.openAssetStudio)!(value),
    shortcut: () => handlers.get(IPC_CHANNELS.app.createAssetStudioShortcut)!(event),
  };
};

test("studio launches the installed EXE through its independent entry", async () => {
  const f = fixture();
  await f.open();
  assert.equal(f.spawns[0].file, "C:/fixture/ShangHao.exe");
  assert.equal(JSON.stringify(f.spawns[0].args), '["--asset-studio"]');
  assert.equal(f.shortcuts.length, 0);
});
test("development launch includes the project folder", async () => {
  const f = fixture({ packaged: false });
  await f.open();
  assert.equal(JSON.stringify(f.spawns[0].args), '["C:/fixture/project","--asset-studio"]');
});
test("studio rejects other windows and subframes", async () => {
  const f = fixture();
  await assert.rejects(f.open({ ...f.event, sender: {} as typeof f.event.sender }), /无效/);
  await assert.rejects(f.open({ ...f.event, senderFrame: {} }), /无效/);
  assert.equal(f.spawns.length, 0);
});
test("missing packaged assets and failed spawn are reported", async () => {
  const f = fixture({ missing: true });
  await assert.rejects(f.open(), /missing/);
  assert.equal(f.spawns.length, 0);
  await assert.rejects(fixture({ spawnFails: true }).open(), /spawn failed/);
});
test("desktop shortcut targets the same stable EXE and does not start it", async () => {
  const f = fixture();
  await f.shortcut();
  assert.equal(f.shortcuts[0].options.target, "C:/fixture/ShangHao.exe");
  assert.equal(f.shortcuts[0].options.args, "--asset-studio");
  assert.ok(f.shortcuts[0].file.endsWith("上号素材.lnk"));
  assert.equal(f.spawns.length, 0);
});
test("shortcut failures and unsupported platforms remain visible", async () => {
  await assert.rejects(fixture({ shortcutFails: true }).shortcut(), /未创建/);
  await assert.rejects(fixture({ platform: "darwin" }).shortcut(), /Windows/);
});
test("early entry loads only the requested application's services", () => {
  for (const studio of [true, false]) {
    const loaded: string[] = [];
    let starts = 0;
    runInNewContext(compile("entry"), {
      exports: {},
      __filename: "C:/fixture/index.cjs",
      __dirname: "C:/fixture/main",
      process: {
        argv: studio ? ["app", "--asset-studio"] : ["app"],
        resourcesPath: "C:/fixture/resources",
      },
      require: (id: string) => {
        if (id === "node:path") return path;
        if (id === "node:module")
          return {
            createRequire: () => (name: string) => {
              loaded.push(name);
              return { startStudio: () => starts++ };
            },
          };
        if (id === "electron") return { app: { isPackaged: true }, dialog: {} };
        throw Error(id);
      },
    });
    assert.equal(loaded.length, 1);
    assert.ok(loaded[0].endsWith(studio ? "desktop.cjs" : "app.cjs"));
    assert.equal(starts, studio ? 1 : 0);
  }
});
test("installer sends graceful quit to both independent profiles", () => {
  const installer = readFileSync(new URL("../build/installer.nsh", import.meta.url), "utf8");
  assert.match(
    installer,
    /Exec '"\$\{EXECUTABLE_PATH\}" --asset-studio --shanghao-quit-for-install'/,
  );
  const studio = readFileSync(
    new URL("../../../tools/asset-review/desktop.cjs", import.meta.url),
    "utf8",
  );
  assert.match(studio, /argv.includes\("--shanghao-quit-for-install"\)/);
});
