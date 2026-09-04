import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
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
  signal?: AbortSignal;
  onRetry?: (context: {
    attempt: number;
    source: RuntimeArtifactSource;
    error: unknown;
  }) => void | Promise<void>;
}

const fileSize = (filePath: string): Promise<number> =>
  stat(filePath)
    .then((value) => value.size)
    .catch(() => 0);

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

const wait = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const verifyArtifact = async (
  filePath: string,
  expectedBytes: number,
  expectedSha256: string,
): Promise<boolean> => {
  if ((await fileSize(filePath)) !== expectedBytes) return false;
  return (await sha256RuntimeArtifact(filePath)) === expectedSha256.toLowerCase();
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
    await rm(options.destination, { force: true });
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
        received += chunk.length;
        refreshIdleTimeout();
        callback(null, chunk);
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
    await rm(options.destination, { force: true });
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
  if (options.signal?.aborted) throw new Error("ai_task_paused");
  if (!options.sources.length) throw new Error("runtime_artifact_source_missing");
  await mkdir(path.dirname(options.destination), { recursive: true });
  if (await verifyArtifact(options.destination, options.expectedBytes, options.expectedSha256)) {
    return options.destination;
  }
  await rm(options.destination, { force: true });

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
      if (attempt < attempts) await wait(Math.min(8_000, attempt * 1_000));
    }
  }
  throw new Error("runtime_artifact_download_failed", { cause: lastError });
};
