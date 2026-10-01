import { waitForTask as wait } from "./task-cancellation";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type RuntimeArtifactFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RuntimeArtifactSource {
  url: string;
  headers?: Record<string, string>;
}

interface RuntimeArtifactDownloadOptions {
  destination: string;
  expectedBytes: number;
  expectedSha256: string;
  sources: readonly RuntimeArtifactSource[];
  fetcher?: RuntimeArtifactFetcher;
  attempts?: number;
  idleTimeoutMs?: number;
  lockWaitTimeoutMs?: number;
  signal?: AbortSignal;
  consumeBytes?: (bytes: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (context: {
    attempt: number;
    source: RuntimeArtifactSource;
    error: unknown;
  }) => void | Promise<void>;
}

const fileSize = (filePath: string): Promise<number> =>
  stat(filePath)
    .then((value) => value.size)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });

export const runtimeArtifactResumeHeaders = (
  offset: number,
  headers: Record<string, string> = {},
): Record<string, string> => ({
  ...headers,
  ...(offset > 0 ? { Range: `bytes=${offset}-` } : {}),
});

export const sha256RuntimeArtifact = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
};

const verifyArtifact = async (
  filePath: string,
  expectedBytes: number,
  expectedSha256: string,
): Promise<boolean> => {
  if ((await fileSize(filePath)) !== expectedBytes) return false;
  return (await sha256RuntimeArtifact(filePath)) === expectedSha256.toLowerCase();
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Serializes writers for the same artifact across app processes, not just within one process. */
const acquireArtifactLock = async (
  destination: string,
  signal?: AbortSignal,
  lockWaitTimeoutMs = 30 * 60_000,
): Promise<() => Promise<void>> => {
  const lockDirectory = `${destination}.lock`;
  const reclaimDirectory = `${lockDirectory}.reclaim`;
  const ownerToken = randomUUID();
  const ownerPath = path.join(lockDirectory, "owner.json");
  const reclaimOwnerPath = path.join(reclaimDirectory, "owner.json");
  const staleOwnerGraceMs = 30_000;
  const lockWaitStartedAt = Date.now();

  while (true) {
    if (signal?.aborted) throw new Error("ai_task_paused");
    if (Date.now() - lockWaitStartedAt >= lockWaitTimeoutMs) {
      throw new Error("runtime_artifact_lock_timeout");
    }
    try {
      await mkdir(lockDirectory);
      await writeFile(ownerPath, JSON.stringify({ pid: process.pid, token: ownerToken }), {
        flag: "wx",
      });
      return async () => {
        try {
          const owner = JSON.parse(await readFile(ownerPath, "utf8")) as { token?: string };
          if (owner.token === ownerToken) await rm(lockDirectory, { recursive: true, force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    let owner: { pid?: number; token?: string } | undefined;
    let lockAgeMs: number;
    try {
      owner = JSON.parse(await readFile(ownerPath, "utf8")) as { pid?: number; token?: string };
      lockAgeMs = Date.now() - (await stat(lockDirectory)).mtimeMs;
    } catch {
      try {
        lockAgeMs = Date.now() - (await stat(lockDirectory)).mtimeMs;
      } catch {
        continue;
      }
    }

    const ownerIsDead = Number.isSafeInteger(owner?.pid) && !processIsAlive(owner!.pid!);
    const ownerMetadataIsAbandoned = !owner?.pid && lockAgeMs >= staleOwnerGraceMs;
    if (ownerIsDead || ownerMetadataIsAbandoned) {
      let ownsReclaim = false;
      try {
        await mkdir(reclaimDirectory);
        ownsReclaim = true;
        await writeFile(reclaimOwnerPath, JSON.stringify({ pid: process.pid, token: ownerToken }), {
          flag: "wx",
        });
      } catch (error) {
        if (ownsReclaim) {
          await rm(reclaimDirectory, { recursive: true, force: true });
          ownsReclaim = false;
        }
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (ownsReclaim) {
        try {
          let currentOwner: { pid?: number; token?: string } | undefined;
          try {
            currentOwner = JSON.parse(await readFile(ownerPath, "utf8")) as {
              pid?: number;
              token?: string;
            };
          } catch {
            // A crashed process may have created the lock directory before its owner file.
          }
          const stillAbandoned = currentOwner?.token
            ? Number.isSafeInteger(currentOwner.pid) && !processIsAlive(currentOwner.pid!)
            : ownerMetadataIsAbandoned && lockAgeMs >= staleOwnerGraceMs;
          if (stillAbandoned) await rm(lockDirectory, { recursive: true, force: true });
        } finally {
          await rm(reclaimDirectory, { recursive: true, force: true });
        }
      } else {
        let reclaimOwner: { pid?: number } | undefined;
        let reclaimAgeMs = 0;
        try {
          reclaimOwner = JSON.parse(await readFile(reclaimOwnerPath, "utf8")) as {
            pid?: number;
          };
          reclaimAgeMs = Date.now() - (await stat(reclaimDirectory)).mtimeMs;
        } catch {
          try {
            reclaimAgeMs = Date.now() - (await stat(reclaimDirectory)).mtimeMs;
          } catch {
            // Another process already released or reclaimed it.
          }
        }
        const reclaimOwnerIsDead =
          Number.isSafeInteger(reclaimOwner?.pid) && !processIsAlive(reclaimOwner!.pid!);
        if (reclaimOwnerIsDead || (!reclaimOwner?.pid && reclaimAgeMs >= staleOwnerGraceMs)) {
          const abandonedPath = `${reclaimDirectory}.abandoned-${randomUUID()}`;
          try {
            await rename(reclaimDirectory, abandonedPath);
            await rm(abandonedPath, { recursive: true, force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      }
    }

    await wait(100, signal);
  }
};

const downloadAttempt = async (
  options: RuntimeArtifactDownloadOptions,
  source: RuntimeArtifactSource,
  partial: string,
): Promise<void> => {
  let offset = await fileSize(partial);
  if (offset > options.expectedBytes) {
    await rm(partial, { force: true });
    offset = 0;
  }
  if (
    offset === options.expectedBytes &&
    (await verifyArtifact(partial, options.expectedBytes, options.expectedSha256))
  ) {
    if (options.signal?.aborted) throw new Error("ai_task_paused");
    await rename(partial, options.destination);
    return;
  }
  if (offset === options.expectedBytes) {
    await rm(partial, { force: true });
    offset = 0;
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const idleTimeoutMs = options.idleTimeoutMs ?? 120_000;
  let idleTimer: NodeJS.Timeout | undefined;
  const refreshIdleTimeout = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  refreshIdleTimeout();

  try {
    const response = await (options.fetcher ?? globalThis.fetch)(source.url, {
      headers: runtimeArtifactResumeHeaders(offset, source.headers),
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`runtime_artifact_http_${response.status}`);
    }
    if (offset > 0 && response.status === 200) {
      await rm(partial, { force: true });
      offset = 0;
    }
    if (response.status === 206) {
      const returnedOffset = Number(
        response.headers.get("content-range")?.match(/^bytes (\d+)-/)?.[1],
      );
      if (!Number.isFinite(returnedOffset) || returnedOffset !== offset) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("runtime_artifact_invalid_content_range");
      }
    }
    if (!response.body) throw new Error("runtime_artifact_empty_response");

    let received = offset;
    const progress = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        if (received + chunk.length > options.expectedBytes) {
          callback(new Error("runtime_artifact_oversized"));
          return;
        }
        received += chunk.length;
        refreshIdleTimeout();
        if (options.consumeBytes)
          void options
            .consumeBytes(chunk.length, controller.signal)
            .then(() => callback(null, chunk), callback);
        else callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as never),
      progress,
      createWriteStream(partial, { flags: offset > 0 ? "a" : "w" }),
      { signal: controller.signal },
    );
    if (received !== options.expectedBytes) throw new Error("runtime_artifact_incomplete");
    if (!(await verifyArtifact(partial, options.expectedBytes, options.expectedSha256))) {
      await rm(partial, { force: true });
      throw new Error("runtime_artifact_checksum_mismatch");
    }
    if (options.signal?.aborted) throw new Error("ai_task_paused");
    await rename(partial, options.destination);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
};

/** Downloads a large immutable runtime artifact with retry, source fallback and resume support. */
export const downloadVerifiedRuntimeArtifact = async (
  options: RuntimeArtifactDownloadOptions,
): Promise<string> => {
  if (!Number.isSafeInteger(options.expectedBytes) || options.expectedBytes <= 0) {
    throw new Error("runtime_artifact_size_invalid");
  }
  if (
    options.lockWaitTimeoutMs !== undefined &&
    (!Number.isSafeInteger(options.lockWaitTimeoutMs) || options.lockWaitTimeoutMs <= 0)
  ) {
    throw new Error("runtime_artifact_lock_wait_invalid");
  }
  if (options.signal?.aborted) throw new Error("ai_task_paused");
  if (!options.sources.length) throw new Error("runtime_artifact_source_missing");
  await mkdir(path.dirname(options.destination), { recursive: true });
  if (await verifyArtifact(options.destination, options.expectedBytes, options.expectedSha256)) {
    if (options.signal?.aborted) throw new Error("ai_task_paused");
    return options.destination;
  }

  const releaseLock = await acquireArtifactLock(
    options.destination,
    options.signal,
    options.lockWaitTimeoutMs,
  );
  try {
    if (await verifyArtifact(options.destination, options.expectedBytes, options.expectedSha256)) {
      if (options.signal?.aborted) throw new Error("ai_task_paused");
      return options.destination;
    }

    const partial = `${options.destination}.part`;
    const attempts = Math.max(options.sources.length, options.attempts ?? 6);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (options.signal?.aborted) throw new Error("ai_task_paused");
      const source = options.sources[(attempt - 1) % options.sources.length]!;
      try {
        await downloadAttempt(options, source, partial);
        if (
          await verifyArtifact(options.destination, options.expectedBytes, options.expectedSha256)
        ) {
          return options.destination;
        }
        throw new Error("runtime_artifact_verification_failed");
      } catch (error) {
        if (options.signal?.aborted) throw new Error("ai_task_paused", { cause: error });
        lastError = error;
        await options.onRetry?.({ attempt, source, error });
        if (attempt < attempts) await wait(Math.min(8_000, attempt * 1_000), options.signal);
      }
    }
    throw new Error("runtime_artifact_download_failed", { cause: lastError });
  } finally {
    await releaseLock();
  }
};
