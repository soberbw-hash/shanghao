import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runLocalProcess } from "../src/main/local-process";

const python = process.env.SHANGHAO_TEST_PYTHON;

test(
  "cancelling a long private pip build terminates its child without touching user runtimes",
  { skip: !python || process.platform !== "win32" },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-long-pip-"));
    const packageRoot = path.join(directory, "package");
    const target = path.join(directory, "target");
    const temp = path.join(directory, "temp");
    const marker = path.join(directory, "backend.pid");
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    try {
      await Promise.all([mkdir(packageRoot), mkdir(temp)]);
      await writeFile(
        path.join(packageRoot, "pyproject.toml"),
        '[build-system]\nrequires = []\nbuild-backend = "backend"\nbackend-path = ["."]\n',
      );
      await writeFile(
        path.join(packageRoot, "backend.py"),
        [
          "import os",
          "import time",
          "def get_requires_for_build_wheel(config_settings=None):",
          "    return []",
          "def prepare_metadata_for_build_wheel(metadata_directory, config_settings=None):",
          "    with open(os.environ['SHANGHAO_PIP_TEST_MARKER'], 'w') as marker:",
          "        marker.write(str(os.getpid()))",
          "    time.sleep(60)",
          "    raise RuntimeError('cancel did not stop the build')",
          "",
        ].join("\n"),
      );
      pending = runLocalProcess(
        python!,
        [
          "-m",
          "pip",
          "install",
          "--disable-pip-version-check",
          "--no-input",
          "--no-cache-dir",
          "--no-build-isolation",
          "--no-deps",
          "--target",
          target,
          packageRoot,
        ],
        {
          signal: controller.signal,
          timeoutMs: 30_000,
          env: {
            ...process.env,
            TMP: temp,
            TEMP: temp,
            SHANGHAO_PIP_TEST_MARKER: marker,
          },
        },
      );

      let backendPid: number | undefined;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        try {
          backendPid = Number(await readFile(marker, "utf8"));
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      assert.ok(backendPid && Number.isSafeInteger(backendPid), "pip backend did not start");
      controller.abort();
      await assert.rejects(pending, /ai_task_paused/);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.throws(() => process.kill(backendPid, 0), { code: "ESRCH" });
    } finally {
      controller.abort();
      await pending?.catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
