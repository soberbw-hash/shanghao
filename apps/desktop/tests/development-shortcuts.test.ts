import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const fixture = (packaged = false, collision = true) => {
  const writes: Array<{
    file: string;
    options: { target: string; args: string; appUserModelId: string; icon: string };
  }> = [];
  const moved: string[] = [];
  const exports = {} as {
    repairDevelopmentShortcuts: () => void;
    developmentRelaunchCommand: () => string;
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../src/main/development-shortcuts.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
  ).outputText;
  runInNewContext(code, {
    exports,
    process: {
      execPath: "C:/fixture/electron.exe",
      env: { LOCALAPPDATA: "C:/fixture/Local", SystemRoot: "C:/Windows" },
    },
    Date,
    require: (id: string) => {
      if (id === "node:path") return path;
      if (id === "node:fs")
        return {
          existsSync: () => true,
          mkdirSync: () => undefined,
          realpathSync: (p: string) => p,
          copyFileSync: (p: string) => moved.push(p),
        };
      if (id === "@private-voice/shared") return { APP_ID: "com.sober.shanghao", APP_NAME: "上号" };
      if (id === "./platform/PlatformService") return { platformService: { isWindows: true } };
      if (id === "electron")
        return {
          app: {
            isPackaged: packaged,
            getAppPath: () => "C:/fixture/project",
            getPath: (name: string) => `C:/fixture/${name}`,
          },
          shell: {
            readShortcutLink: () => ({
              target: "C:/fixture/electron.exe",
              args: "",
              appUserModelId: collision ? "com.sober.shanghao.dev" : "other.app",
            }),
            writeShortcutLink: (
              file: string,
              _mode: string,
              options: (typeof writes)[number]["options"],
            ) => {
              writes.push({ file, options });
              return true;
            },
          },
        };
      throw Error(id);
    },
  });
  return { writes, moved, ...exports };
};

test("development shortcuts back up only the conflicting Electron entry and share a branded launcher", () => {
  const f = fixture();
  f.repairDevelopmentShortcuts();
  assert.equal(f.moved.length, 1);
  assert.equal(f.writes.length, 3);
  for (const { options } of f.writes) {
    assert.equal(options.appUserModelId, "com.sober.shanghao.dev");
    assert.match(options.target, /wscript\.exe$/);
    assert.match(options.args, /launch-dev\.vbs/);
    assert.match(options.icon, /shanghao-icon-v4\.ico$/);
  }
  assert.match(f.developmentRelaunchCommand(), /launch-dev\.vbs/);
});
test("development repair leaves unrelated Electron entries and packaged installs alone", () => {
  const unrelated = fixture(false, false);
  unrelated.repairDevelopmentShortcuts();
  assert.equal(unrelated.moved.length, 0);
  const packaged = fixture(true);
  packaged.repairDevelopmentShortcuts();
  assert.equal(packaged.writes.length, 0);
});
