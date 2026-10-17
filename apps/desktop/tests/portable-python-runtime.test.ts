import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  preparePortablePython,
  type PortablePythonOptions,
} from "../src/main/portable-python-runtime";

for (const failure of ["download", "install", "cancel", "none"] as const) {
  test(`portable Python publishes only a verified complete installation: ${failure}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-python-"));
    const executable = path.join(root, "python", "python.exe");
    const controller = new AbortController();
    let downloads = 0;
    const options: PortablePythonOptions = {
      download: async (_artifact, destination) => {
        downloads++;
        if (failure === "download") throw new Error("network_failure");
        await writeFile(destination, "fixture");
        return destination;
      },
      execute: async (command, args) => {
        if (
          command === "tar.exe" &&
          args.includes(path.join(root, "downloads", "python-3.12.10", "python.zip"))
        ) {
          const stage = args.at(-1)!;
          await writeFile(path.join(stage, "python.exe"), "fixture");
          await writeFile(path.join(stage, "python312._pth"), "fixture");
        }
        if (command.endsWith("python.exe")) {
          // The destination must remain invisible during installation/probing.
          await assert.rejects(access(executable));
          if (failure === "install") throw new Error("pip_failure");
          if (failure === "cancel") controller.abort();
        }
        return { stdout: "runtime_ready", stderr: "" };
      },
    };
    try {
      const operation = preparePortablePython(executable, options, controller.signal);
      if (failure === "none") {
        await operation;
        await access(executable);
        await preparePortablePython(executable, options);
        assert.equal(downloads, 2, "a valid existing interpreter must not download again");
      } else {
        await assert.rejects(operation, /network_failure|pip_failure|ai_task_paused/);
        await assert.rejects(access(executable));
      }
      assert.equal(
        (await readdir(root)).some((entry) => entry.startsWith("python-install-")),
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("an incomplete existing Python directory is preserved", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-python-existing-"));
  try {
    await mkdir(path.join(root, "python"));
    await writeFile(path.join(root, "python", "keep.txt"), "keep");
    await assert.rejects(
      preparePortablePython(path.join(root, "python", "python.exe")),
      /directory_incomplete/,
    );
    await access(path.join(root, "python", "keep.txt"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
