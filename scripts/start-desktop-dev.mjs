import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import { developmentBundlesReady } from "./desktop-dev-runtime.mjs";

const repository = process.argv[2];
if (!repository) throw new Error("需要指定上号源码目录");
const directory = path.join(repository, "apps", "desktop");
const electron = path.join(directory, "node_modules", "electron", "dist", "electron.exe");
const logs = path.join(process.env.LOCALAPPDATA, "Programs", "ShangHaoDev");
mkdirSync(logs, { recursive: true });
const output = openSync(path.join(logs, "start-dev.log"), "a");
const nodeEnvironment = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
const appEnvironment = { ...process.env };
delete appEnvironment.ELECTRON_RUN_AS_NODE;

function start(args, env, detached = true) {
  const child = spawn(electron, args, {
    cwd: directory,
    env,
    detached,
    windowsHide: args[0] !== ".",
    stdio: ["ignore", output, output],
  });
  return child;
}

async function rendererReady() {
  try {
    const response = await fetch("http://127.0.0.1:5173/@vite/client", {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok && (await response.text()).includes("vite");
  } catch {
    return false;
  }
}

try {
  writeSync(output, `[${new Date().toISOString()}] 正在打开上号开发版\n`);
  if (!existsSync(electron)) throw new Error("开发依赖未安装，找不到 Electron");
  // The desktop shortcut bypasses package.json's dev/build:main pre-step.
  // Refresh changed native input helpers before opening the app; otherwise
  // TypeScript changes can run alongside last week's keyboard companion.
  const nativeBuild = start(
    [path.join(repository, "scripts", "build-phone-audio.mjs")],
    nodeEnvironment,
    false,
  );
  const nativeCode = await new Promise((resolve, reject) => {
    nativeBuild.once("error", reject);
    nativeBuild.once("exit", resolve);
  });
  if (nativeCode !== 0) throw new Error("电话模式组件更新失败，请查看 start-dev.log");
  const hasRenderer = await rendererReady();
  if (!hasRenderer || !(await developmentBundlesReady(directory))) {
    const tsup = path.join(directory, "node_modules", "tsup", "dist", "cli-default.js");
    const vite = path.join(directory, "node_modules", "vite", "bin", "vite.js");
    const build = start([tsup, "--config", "tsup.config.ts"], nodeEnvironment, false);
    const code = await new Promise((resolve, reject) => {
      build.once("error", reject);
      build.once("exit", resolve);
    });
    if (code !== 0) throw new Error("主进程构建失败，请查看 start-dev.log");
    // Detached services survive closing the launcher or the app. A later click
    // reuses the same Vite server instead of creating another watcher.
    const watcher = start([tsup, "--config", "tsup.config.ts", "--watch"], nodeEnvironment);
    watcher.unref();
    if (!hasRenderer) {
      const renderer = start(
        [vite, "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
        nodeEnvironment,
      );
      renderer.unref();
      const deadline = Date.now() + 60_000;
      while (!(await rendererReady())) {
        if (renderer.exitCode !== null || Date.now() > deadline)
          throw new Error("界面开发服务无法启动，请查看 start-dev.log");
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }
  const bundleDeadline = Date.now() + 15_000;
  while (!(await developmentBundlesReady(directory))) {
    if (Date.now() > bundleDeadline) throw new Error("主进程构建尚未完成，请稍后重新打开开发版");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const launched = start(["."], appEnvironment);
  await new Promise((resolve, reject) => {
    launched.once("spawn", resolve);
    launched.once("error", reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  if (launched.exitCode !== null && launched.exitCode !== 0)
    throw new Error(`开发版启动失败（${launched.exitCode}），请查看 start-dev.log`);
  launched.unref();
} catch (error) {
  writeSync(output, `[${new Date().toISOString()}] ${error.stack ?? error}\n`);
  console.error(error);
  process.exitCode = 1;
} finally {
  closeSync(output);
}
