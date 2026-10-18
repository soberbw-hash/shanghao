import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

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
    windowsHide: true,
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
  if (!existsSync(electron)) throw new Error("开发依赖未安装，找不到 Electron");
  if (!(await rendererReady())) {
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
  const launched = start(["."], appEnvironment);
  await new Promise((resolve, reject) => {
    launched.once("spawn", resolve);
    launched.once("error", reject);
  });
  launched.unref();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  closeSync(output);
}
