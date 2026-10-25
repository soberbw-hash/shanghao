import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
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
      if (id === "node:crypto") return { createHash };
      if (id === "node:fs")
        return {
          existsSync: () => true,
          readFileSync: (file: string) =>
            file.endsWith(".ps1")
              ? Buffer.concat([
                  Buffer.from([255, 254]),
                  Buffer.from("Write-Output 'fixture launcher'", "utf16le"),
                ])
              : Buffer.from("fixture icon"),
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
    assert.match(options.target, /powershell\.exe$/);
    assert.match(options.args, /-NoProfile.*-WindowStyle Hidden -EncodedCommand /);
    assert.equal(
      Buffer.from(options.args.split("-EncodedCommand ")[1]!, "base64").toString("utf16le"),
      "Write-Output 'fixture launcher'",
    );
    assert.equal(options.args.includes("ExecutionPolicy"), false);
    assert.match(options.icon, /ShangHaoDev[\\/]shanghao-dev-[a-f0-9]{12}\.ico$/);
    assert.equal(options.icon.includes("project"), false);
  }
  assert.match(f.developmentRelaunchCommand(), /-EncodedCommand /);
});
test("development repair leaves unrelated Electron entries and packaged installs alone", () => {
  const unrelated = fixture(false, false);
  unrelated.repairDevelopmentShortcuts();
  assert.equal(unrelated.moved.length, 0);
  const packaged = fixture(true);
  packaged.repairDevelopmentShortcuts();
  assert.equal(packaged.writes.length, 0);
});
