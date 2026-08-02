import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronExecutable =
  process.platform === "win32"
    ? path.join(root, "apps", "desktop", "node_modules", "electron", "dist", "electron.exe")
    : path.join(root, "apps", "desktop", "node_modules", ".bin", "electron");
const harness = path.join(root, "apps", "desktop", "tests", "electron-five-peer-media-smoke.cjs");
const electronArguments =
  process.platform === "linux" && process.env.CI ? ["--no-sandbox", harness] : [harness];

const result = spawnSync(electronExecutable, electronArguments, {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe",
  timeout: 45_000,
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: result.error.message,
      stage: "launch_electron_media_harness",
    }),
  );
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
