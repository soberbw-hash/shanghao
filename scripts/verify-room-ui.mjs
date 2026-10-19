import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");
const load = createRequire(path.join(desktop, "package.json"));
const electron = load("electron");
const environment = { ...process.env, SHANGHAO_TEST_ORIGIN: "http://127.0.0.1:5193" };
delete environment.ELECTRON_RUN_AS_NODE;
let serverOutput = "";
const server = spawn(
  process.execPath,
  [
    path.join(desktop, "node_modules/vite/bin/vite.js"),
    "--config",
    "tests/vite-ui-check.config.mts",
  ],
  {
    cwd: desktop,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => {
  serverOutput = (serverOutput + chunk).slice(-4000);
});
server.stderr.on("data", (chunk) => {
  serverOutput = (serverOutput + chunk).slice(-4000);
});
let serverError;
server.on("error", (error) => {
  serverError = error;
});
const run = (file, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(desktop, "tests", file), ...args], {
      cwd: desktop,
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)),
    );
  });
try {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (serverError || server.exitCode !== null) throw serverError ?? new Error(serverOutput);
    try {
      const response = await fetch(`${environment.SHANGHAO_TEST_ORIGIN}/@vite/client`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok && serverOutput.includes("5193")) break;
    } catch {
      /* Server startup is bounded by the deadline. */
    }
    if (Date.now() >= deadline) throw new Error(`UI test server timed out: ${serverOutput}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await run("electron-assistant-motion-smoke.cjs");
  await run("electron-assistant-motion-smoke.cjs", ["--reduce-motion"]);
  await run("electron-member-availability-smoke.cjs");
  await run("electron-collection-preview-smoke.cjs");
  await run("electron-settings-feedback-smoke.cjs");
  await run("electron-automatic-settings-optout.cjs");
  await run("electron-recording-library-feedback.cjs");
  await run("electron-room-entry-performance.cjs", ["--assert-continuity", "--assert-cue"]);
  await run("electron-room-entry-performance.cjs", [
    "--assert-continuity",
    "--assert-cue",
    "--reduce-motion",
  ]);
  await run("electron-detached-screen-share-smoke.cjs");
  console.log("Room UI, persistent status and forwarded screen checks passed.");
} finally {
  server.kill();
}
