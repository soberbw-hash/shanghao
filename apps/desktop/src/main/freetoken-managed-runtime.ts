import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RendererLogPayload } from "@private-voice/shared";

import {
  downloadVerifiedRuntimeArtifact,
  type RuntimeArtifactFetcher,
} from "./runtime-artifact-download";
import { runLocalProcess } from "./local-process";
import { platformService } from "./platform/PlatformService";

const RELEASE_ASSETS_URL =
  "https://github.com/FlashML-org/FreeToken-Web/releases/expanded_assets/beta";
const RELEASE_DOWNLOAD_ROOT =
  "https://github.com/FlashML-org/FreeToken-Web/releases/download/beta/";
const UV_INSTALL_SCRIPT = "https://astral.sh/uv/install.ps1";
const MANIFEST_VERSION = 1;
const INSTALL_TIMEOUT_MS = 45 * 60_000;

export interface FreeTokenWindowsAsset {
  name: string;
  url: string;
  sha256: string;
  buildCommit: string;
  updatedAt: string;
}

export interface FreeTokenWindowsAssetPair {
  runtime: FreeTokenWindowsAsset;
  kernelCache: FreeTokenWindowsAsset;
}

interface InstalledRuntimeManifest {
  manifestVersion: number;
  installedAt: string;
  executable: string;
  version: string;
  runtime: Pick<FreeTokenWindowsAsset, "name" | "sha256" | "buildCommit">;
  kernelCache: Pick<FreeTokenWindowsAsset, "name" | "sha256" | "buildCommit">;
}

export interface FreeTokenManagedRuntimeStatus {
  ready: boolean;
  executable?: string;
  version?: string;
  managed: boolean;
  message?: string;
}

interface FreeTokenManagedRuntimeOptions {
  fetcher?: RuntimeArtifactFetcher;
  writeLog?: (payload: RendererLogPayload) => Promise<void>;
  runProcess?: typeof runLocalProcess;
  legacyExecutablePaths?: readonly string[];
}

const decodeHtml = (value: string): string =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#43;", "+")
    .replaceAll("&#x2B;", "+");

const buildCommitFromName = (name: string): string | undefined =>
  name.match(/[+.]g([0-9a-f]{7,40})[-.]/i)?.[1]?.toLowerCase();

const releaseAssetFromRow = (row: string): FreeTokenWindowsAsset | undefined => {
  const href = decodeHtml(row.match(/href="([^"]*\/releases\/download\/beta\/[^"]+)"/i)?.[1] ?? "");
  const name = href.split("/").at(-1);
  const sha256 = row.match(/sha256:([0-9a-f]{64})/i)?.[1]?.toLowerCase();
  const updatedAt = row.match(/<relative-time[^>]*datetime="([^"]+)"/i)?.[1] ?? "";
  if (!href || !name || !sha256) return undefined;
  const decodedName = decodeURIComponent(name);
  const buildCommit = buildCommitFromName(decodedName);
  if (!buildCommit) return undefined;
  return {
    name: decodedName,
    url: new URL(href, "https://github.com").toString(),
    sha256,
    buildCommit,
    updatedAt,
  };
};

/** Selects the newest matching CPython 3.12 Windows runtime/kernel-cache pair. */
export const parseFreeTokenWindowsAssetPair = (html: string): FreeTokenWindowsAssetPair => {
  const assets = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => releaseAssetFromRow(match[1] ?? ""))
    .filter((asset): asset is FreeTokenWindowsAsset => Boolean(asset));
  const runtimes = assets.filter((asset) =>
    /^freetoken-(?!kernel[_-]cache).*cp312-cp312-win_amd64\.whl$/i.test(asset.name),
  );
  const kernelCaches = assets.filter((asset) =>
    /^freetoken[_-]kernel[_-]cache-.*py3-none-win_amd64\.whl$/i.test(asset.name),
  );
  const pairs = runtimes.flatMap((runtime) => {
    const kernelCache = kernelCaches.find(
      (candidate) => candidate.buildCommit === runtime.buildCommit,
    );
    return kernelCache ? [{ runtime, kernelCache }] : [];
  });
  const selected = pairs.sort((left, right) => {
    const leftTime = Date.parse(left.runtime.updatedAt || left.kernelCache.updatedAt) || 0;
    const rightTime = Date.parse(right.runtime.updatedAt || right.kernelCache.updatedAt) || 0;
    return rightTime - leftTime;
  })[0];
  if (!selected) throw new Error("freetoken_windows_release_pair_missing");
  return selected;
};

const firstExisting = (values: readonly (string | undefined)[]): string | undefined =>
  values.find((value): value is string => Boolean(value && existsSync(value)));

const atomicWriteJson = async (file: string, value: unknown): Promise<void> => {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, file);
};

const responseByteLength = async (
  fetcher: RuntimeArtifactFetcher,
  url: string,
): Promise<number> => {
  const head = await fetcher(url, { method: "HEAD", redirect: "follow" });
  try {
    const length = Number(head.headers.get("content-length"));
    if (head.ok && Number.isFinite(length) && length > 0) return length;
  } finally {
    await head.body?.cancel().catch(() => undefined);
  }
  const probe = await fetcher(url, {
    headers: { Range: "bytes=0-0" },
    redirect: "follow",
  });
  try {
    const total = Number(probe.headers.get("content-range")?.match(/\/(\d+)$/)?.[1]);
    if (Number.isFinite(total) && total > 0) return total;
  } finally {
    await probe.body?.cancel().catch(() => undefined);
  }
  throw new Error("freetoken_release_asset_size_missing");
};

/**
 * Installs and owns FreeToken's official Windows wheels as an invisible ShangHao sidecar.
 * It never installs FreeToken Desktop, writes PATH/FREETOKEN_FT_BIN, or opens a LAN listener.
 */
export class FreeTokenManagedRuntime {
  readonly rootDirectory: string;
  readonly managedExecutable: string;
  private readonly uvDirectory: string;
  private readonly downloadsDirectory: string;
  private readonly manifestPath: string;
  private readonly fetcher: RuntimeArtifactFetcher;
  private readonly execute: typeof runLocalProcess;
  private preparePromise?: Promise<FreeTokenManagedRuntimeStatus>;

  constructor(
    runtimeRoot: string,
    private readonly options: FreeTokenManagedRuntimeOptions = {},
  ) {
    this.rootDirectory = path.join(runtimeRoot, "freetoken-windows-v1");
    this.managedExecutable = path.join(this.rootDirectory, "venv", "Scripts", "ft.exe");
    this.uvDirectory = path.join(this.rootDirectory, "uv");
    this.downloadsDirectory = path.join(this.rootDirectory, "downloads");
    this.manifestPath = path.join(this.rootDirectory, "runtime-manifest.json");
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.execute = options.runProcess ?? runLocalProcess;
  }

  executablePath(): string | undefined {
    return firstExisting([
      this.managedExecutable,
      process.env.SHANGHAO_FREETOKEN_CLI,
      ...(this.options.legacyExecutablePaths ?? []),
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "FreeToken", "venv", "Scripts", "ft.exe")
        : undefined,
    ]);
  }

  prepare(signal?: AbortSignal): Promise<FreeTokenManagedRuntimeStatus> {
    if (this.preparePromise) return this.preparePromise;
    const operation = this.prepareOnce(signal).finally(() => {
      if (this.preparePromise === operation) this.preparePromise = undefined;
    });
    this.preparePromise = operation;
    return operation;
  }

  private async prepareOnce(signal?: AbortSignal): Promise<FreeTokenManagedRuntimeStatus> {
    if (!platformService.isWindows) {
      return {
        ready: false,
        managed: false,
        message: "FreeToken 本地整理目前只在 Windows x86_64 + NVIDIA 上启用。",
      };
    }
    const existing = this.executablePath();
    if (existing) return this.validate(existing, existing === this.managedExecutable);

    await mkdir(this.downloadsDirectory, { recursive: true });
    await this.log("info", "freetoken_managed_runtime_prepare_started", {
      rootDirectory: this.rootDirectory,
    });
    const assetsResponse = await this.fetcher(RELEASE_ASSETS_URL, {
      redirect: "follow",
      signal,
      headers: { Accept: "text/html" },
    });
    if (!assetsResponse.ok) {
      await assetsResponse.body?.cancel().catch(() => undefined);
      throw new Error(`freetoken_release_assets_http_${assetsResponse.status}`);
    }
    const pair = parseFreeTokenWindowsAssetPair(await assetsResponse.text());
    const [runtimeBytes, kernelCacheBytes] = await Promise.all([
      responseByteLength(this.fetcher, pair.runtime.url),
      responseByteLength(this.fetcher, pair.kernelCache.url),
    ]);
    const [runtimeWheel, kernelCacheWheel] = await Promise.all([
      this.downloadAsset(pair.runtime, runtimeBytes, signal),
      this.downloadAsset(pair.kernelCache, kernelCacheBytes, signal),
    ]);
    if (signal?.aborted) throw new Error("ai_task_paused");

    const uv = await this.ensureUv(signal);
    const venvPython = path.join(this.rootDirectory, "venv", "Scripts", "python.exe");
    if (!existsSync(venvPython)) {
      await this.execute(uv, ["venv", path.dirname(path.dirname(venvPython)), "--python", "3.12"], {
        env: this.installEnvironment(),
        signal,
        timeoutMs: 20 * 60_000,
      });
    }
    await this.execute(
      uv,
      [
        "pip",
        "install",
        "--python",
        path.dirname(path.dirname(venvPython)),
        "--torch-backend=cu130",
        "--reinstall-package",
        "freetoken",
        "--reinstall-package",
        "freetoken-kernel-cache",
        "--refresh-package",
        "freetoken",
        "--refresh-package",
        "freetoken-kernel-cache",
        runtimeWheel,
        kernelCacheWheel,
      ],
      {
        env: this.installEnvironment(),
        signal,
        timeoutMs: INSTALL_TIMEOUT_MS,
      },
    );
    const status = await this.validate(this.managedExecutable, true);
    if (!status.ready || !status.version)
      throw new Error(status.message ?? "freetoken_self_check_failed");
    const manifest: InstalledRuntimeManifest = {
      manifestVersion: MANIFEST_VERSION,
      installedAt: new Date().toISOString(),
      executable: this.managedExecutable,
      version: status.version,
      runtime: {
        name: pair.runtime.name,
        sha256: pair.runtime.sha256,
        buildCommit: pair.runtime.buildCommit,
      },
      kernelCache: {
        name: pair.kernelCache.name,
        sha256: pair.kernelCache.sha256,
        buildCommit: pair.kernelCache.buildCommit,
      },
    };
    await atomicWriteJson(this.manifestPath, manifest);
    await this.log("info", "freetoken_managed_runtime_ready", {
      executable: this.managedExecutable,
      version: status.version,
      buildCommit: pair.runtime.buildCommit,
    });
    return status;
  }

  private async downloadAsset(
    asset: FreeTokenWindowsAsset,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return downloadVerifiedRuntimeArtifact({
      destination: path.join(this.downloadsDirectory, asset.name),
      expectedBytes,
      expectedSha256: asset.sha256,
      sources: [
        { url: asset.url },
        { url: `${RELEASE_DOWNLOAD_ROOT}${encodeURIComponent(asset.name)}` },
      ],
      fetcher: this.fetcher,
      signal,
      onRetry: ({ attempt, error }) =>
        this.log("warn", "freetoken_managed_runtime_download_retry", {
          asset: asset.name,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        }),
    });
  }

  private async ensureUv(signal?: AbortSignal): Promise<string> {
    const managedUv = path.join(this.uvDirectory, "uv.exe");
    const reusableUv = firstExisting([
      managedUv,
      process.env.FREETOKEN_UV,
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "FreeToken", "uv", "uv.exe")
        : undefined,
    ]);
    if (reusableUv) return reusableUv;
    await mkdir(this.uvDirectory, { recursive: true });
    await this.execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$ProgressPreference='SilentlyContinue'; irm '${UV_INSTALL_SCRIPT}' | iex`,
      ],
      {
        env: {
          ...process.env,
          UV_UNMANAGED_INSTALL: this.uvDirectory,
          UV_NO_MODIFY_PATH: "1",
        },
        signal,
        timeoutMs: 5 * 60_000,
      },
    );
    if (!existsSync(managedUv)) throw new Error("freetoken_uv_bootstrap_failed");
    return managedUv;
  }

  private installEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      UV_NO_MODIFY_PATH: "1",
      UV_PYTHON_INSTALL_DIR: path.join(this.rootDirectory, "python"),
      UV_PYTHON_PREFERENCE: "only-managed",
    };
  }

  private async validate(
    executable: string,
    managed: boolean,
  ): Promise<FreeTokenManagedRuntimeStatus> {
    try {
      const result = await this.execute(executable, ["--version"], { timeoutMs: 15_000 });
      const version = (result.stdout || result.stderr).trim().split(/\s+/).at(-1);
      if (!version) throw new Error("freetoken_version_missing");
      return {
        ready: true,
        executable,
        version,
        managed,
        message: managed
          ? "上号本地运行组件已就绪。"
          : "已接管现有 FreeToken 命令行引擎；无需打开 FreeToken Desktop。",
      };
    } catch (error) {
      return {
        ready: false,
        executable,
        managed,
        message: `FreeToken 本地运行组件无法启动：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async installedManifest(): Promise<InstalledRuntimeManifest | undefined> {
    try {
      return JSON.parse(await readFile(this.manifestPath, "utf8")) as InstalledRuntimeManifest;
    } catch {
      return undefined;
    }
  }

  private log(
    level: RendererLogPayload["level"],
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    return (
      this.options.writeLog?.({ category: "app", level, message, context }) ?? Promise.resolve()
    );
  }
}
