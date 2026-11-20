import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const executable = path.resolve(
  process.argv[2] ?? "apps/desktop/release/win-unpacked/ShangHao.exe",
);
const directory = mkdtempSync(path.join(os.tmpdir(), "shanghao-packaged-capture-"));
try {
  const probe = spawnSync(executable, ["--verify-screen-capture"], {
    env: { ...process.env, SHANGHAO_SCREEN_CAPTURE_PROBE_DIR: directory },
    encoding: "utf8",
    windowsHide: true,
    timeout: 35_000,
  });
  if (probe.error) throw probe.error;
  const report = path.join(directory, "result.json");
  assert.ok(
    existsSync(report),
    `Packaged app exited with ${probe.status} before reporting a capture result. ${probe.stderr}`,
  );
  const result = JSON.parse(readFileSync(report, "utf8"));
  assert.equal(probe.status, 0, result.error);
  assert.equal(result.ok, true);
  assert.equal(result.elevated, false);
  assert.equal(result.frame.length, 2);
  assert.ok(result.frame.every((dimension) => Number.isInteger(dimension) && dimension > 0));
  console.log(
    `Packaged ShangHao ${result.version} captured ${result.frame.join("×")} at standard privilege`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}
