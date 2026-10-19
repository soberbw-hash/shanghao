import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const desktop = path.join(root, "apps/desktop");
const require = createRequire(path.join(desktop, "package.json"));
const env = {
  ...process.env,
  SHANGHAO_TEST_ORIGIN: "http://127.0.0.1:5196",
  SHANGHAO_RELEASE_CAPTURE: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const server = spawn(
  process.execPath,
  [
    path.join(desktop, "node_modules/vite/bin/vite.js"),
    "--config",
    "tests/vite-ui-check.config.mts",
    "--port",
    "5196",
  ],
  { cwd: desktop, env, windowsHide: true, stdio: "ignore" },
);
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${env.SHANGHAO_TEST_ORIGIN}/@vite/client`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* bounded startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("AI capture server timed out");
  for (const entry of [
    "electron-release-ai-capture.cjs",
    "electron-recording-library-feedback.cjs",
  ]) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [path.join(desktop, "tests", entry)], {
        cwd: desktop,
        env,
        windowsHide: true,
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("exit", resolve);
    });
    if (code !== 0) throw new Error(`AI capture exited ${code}`);
  }
} finally {
  server.kill();
}
