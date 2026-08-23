import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { resolveFfmpegExecutable } from "../src/main/media-runtime";

test("resolves a runnable FFmpeg executable when pnpm's direct virtual package lacks its binary", () => {
  const executable = resolveFfmpegExecutable();
  assert.ok(executable, "FFmpeg should resolve from packaged resources or the pnpm store");
  assert.equal(existsSync(executable), true);

  const probe = spawnSync(executable, ["-version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  assert.equal(probe.status, 0);
  assert.match(`${probe.stdout}\n${probe.stderr}`, /ffmpeg version/i);
});
