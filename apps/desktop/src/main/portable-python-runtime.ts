import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runLocalProcess } from "./local-process";
import { downloadRuntimeComponent } from "./runtime-component-download";
import type { RuntimeArtifactFetcher } from "./runtime-artifact-download";

// Immutable upstream artifacts; never borrow a system/other application's Python.
export const PORTABLE_PYTHON = {
  bytes: 11133606,
  sha256: "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3",
  sources: [{ url: "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip" }],
};
const PIP_WHEEL = {
  bytes: 1816632,
  sha256: "71138adf1f4ca900cdb7d289c21b7494329f2332b6d85f0e1c42108c0384ed3e",
  sources: [
    {
      url: "https://files.pythonhosted.org/packages/f3/6e/1736e5b4ae2b778ef2f81c47d797de9f891d4d8acb047a24ca37a60294dd/pip-26.2.1-py3-none-any.whl",
    },
  ],
};
const exists = (file: string) =>
  access(file).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

export interface PortablePythonOptions {
  fetcher?: RuntimeArtifactFetcher;
  consumeBytes?: (bytes: number, signal?: AbortSignal) => Promise<void>;
  execute?: typeof runLocalProcess;
  download?: typeof downloadRuntimeComponent;
}

/** Publish a complete private interpreter only after pip and native imports work. */
export const preparePortablePython = async (
  executable: string,
  options: PortablePythonOptions = {},
  signal?: AbortSignal,
): Promise<void> => {
  if (await exists(executable)) return;
  if (signal?.aborted) throw new Error("ai_task_paused");
  const destination = path.dirname(executable);
  // Legacy virtual environments must be repaired by their owner, not overlaid.
  if (path.basename(destination) !== "python" || (await exists(destination))) {
    throw new Error("ai_runtime_python_directory_incomplete");
  }
  const root = path.dirname(destination);
  const stage = path.join(root, `python-install-${randomUUID()}`);
  const downloads = path.join(root, "downloads", "python-3.12.10");
  const execute = options.execute ?? runLocalProcess;
  const download = options.download ?? downloadRuntimeComponent;
  await mkdir(downloads, { recursive: true });
  await mkdir(stage);
  try {
    const downloadOptions = { ...options, signal, onRetry: async () => undefined };
    const archive = await download(
      PORTABLE_PYTHON,
      path.join(downloads, "python.zip"),
      downloadOptions,
    );
    const pip = await download(PIP_WHEEL, path.join(downloads, "pip.whl"), downloadOptions);
    await execute("tar.exe", ["-xf", archive, "-C", stage], { signal, timeoutMs: 120_000 });
    // _pth isolation ignores PYTHONPATH, which the workers use for private providers.
    await rename(path.join(stage, "python312._pth"), path.join(stage, "python312._pth.original"));
    const sitePackages = path.join(stage, "Lib", "site-packages");
    await mkdir(sitePackages, { recursive: true });
    await execute("tar.exe", ["-xf", pip, "-C", sitePackages], { signal, timeoutMs: 120_000 });
    const python = path.join(stage, "python.exe");
    await execute(
      python,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--no-warn-script-location",
        "setuptools==84.0.0",
        "wheel==0.48.0",
      ],
      { signal, timeoutMs: 10 * 60_000 },
    );
    await execute(
      python,
      ["-c", "import pip, setuptools, ssl, ctypes, socket; print('runtime_ready')"],
      { signal, timeoutMs: 30_000 },
    );
    await writeFile(path.join(stage, ".shanghao-embedded-python"), "3.12.10\n");
    if (signal?.aborted) throw new Error("ai_task_paused");
    await rename(stage, destination);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
};
