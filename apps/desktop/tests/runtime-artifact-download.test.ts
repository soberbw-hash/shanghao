import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import assert from "node:assert/strict";

import {
  downloadVerifiedRuntimeArtifact,
  runtimeArtifactResumeHeaders,
} from "../src/main/runtime-artifact-download";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

test("runtime artifact download resumes a verified partial file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-runtime-download-"));
  const destination = path.join(directory, "runtime.whl");
  await writeFile(`${destination}.part`, "hello ", "utf8");
  let requestedRange = "";
  try {
    const result = await downloadVerifiedRuntimeArtifact({
      destination,
      expectedBytes: 11,
      expectedSha256: digest("hello world"),
      sources: [{ url: "https://example.invalid/runtime.whl" }],
      attempts: 1,
      fetcher: async (_input, init) => {
        requestedRange = new Headers(init?.headers).get("range") ?? "";
        return new Response("world", {
          status: 206,
          headers: { "Content-Range": "bytes 6-10/11" },
        });
      },
    });
    assert.equal(result, destination);
    assert.equal(requestedRange, "bytes=6-");
    assert.equal(await readFile(destination, "utf8"), "hello world");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime artifact download falls back to the next official source", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-runtime-fallback-"));
  const destination = path.join(directory, "runtime.whl");
  const requested: string[] = [];
  try {
    await downloadVerifiedRuntimeArtifact({
      destination,
      expectedBytes: 2,
      expectedSha256: digest("ok"),
      sources: [{ url: "https://primary.invalid" }, { url: "https://fallback.invalid" }],
      attempts: 2,
      fetcher: async (input) => {
        requested.push(String(input));
        if (requested.length === 1) throw new Error("ETIMEDOUT");
        return new Response("ok", { status: 200 });
      },
    });
    assert.deepEqual(requested, ["https://primary.invalid", "https://fallback.invalid"]);
    assert.equal(await readFile(destination, "utf8"), "ok");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime artifact keeps an existing file when a replacement download fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-runtime-preserve-"));
  const destination = path.join(directory, "runtime.whl");
  await writeFile(destination, "previous", "utf8");
  try {
    await assert.rejects(
      downloadVerifiedRuntimeArtifact({
        destination,
        expectedBytes: 7,
        expectedSha256: digest("updated"),
        sources: [{ url: "https://example.invalid/runtime.whl" }],
        attempts: 1,
        fetcher: async () => {
          throw new Error("offline");
        },
      }),
      /runtime_artifact_download_failed/,
    );
    assert.equal(await readFile(destination, "utf8"), "previous");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime artifact replaces an existing file only after verifying the new bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-runtime-replace-"));
  const destination = path.join(directory, "runtime.whl");
  await writeFile(destination, "previous", "utf8");
  try {
    await downloadVerifiedRuntimeArtifact({
      destination,
      expectedBytes: 7,
      expectedSha256: digest("updated"),
      sources: [{ url: "https://example.invalid/runtime.whl" }],
      attempts: 1,
      fetcher: async () => new Response("updated", { status: 200 }),
    });
    assert.equal(await readFile(destination, "utf8"), "updated");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime artifact cancellation preserves the existing file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-runtime-cancel-"));
  const destination = path.join(directory, "runtime.whl");
  const controller = new AbortController();
  await writeFile(destination, "previous", "utf8");
  let started!: () => void;
  const fetchStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    const download = downloadVerifiedRuntimeArtifact({
      destination,
      expectedBytes: 7,
      expectedSha256: digest("updated"),
      sources: [{ url: "https://example.invalid/runtime.whl" }],
      attempts: 1,
      signal: controller.signal,
      fetcher: async (_input, init) => {
        started();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
    });
    await fetchStarted;
    controller.abort();
    await assert.rejects(download, /ai_task_paused/);
    assert.equal(await readFile(destination, "utf8"), "previous");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime artifact cancellation interrupts retry delay without contacting the next source", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-runtime-retry-cancel-"));
  const destination = path.join(directory, "runtime.whl");
  const controller = new AbortController();
  let attempts = 0;
  let firstFailure!: () => void;
  const failed = new Promise<void>((resolve) => {
    firstFailure = resolve;
  });
  try {
    const download = downloadVerifiedRuntimeArtifact({
      destination,
      expectedBytes: 2,
      expectedSha256: digest("ok"),
      sources: [{ url: "https://example.invalid/runtime.whl" }],
      attempts: 3,
      signal: controller.signal,
      fetcher: async () => {
        attempts += 1;
        throw new Error("offline");
      },
      onRetry: () => firstFailure(),
    });
    await failed;
    controller.abort();
    await Promise.race([
      assert.rejects(download, /ai_task_paused/),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("cancel_waited_for_retry_delay")), 500),
      ),
    ]);
    assert.equal(attempts, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime artifact resume headers preserve source-specific headers", () => {
  assert.deepEqual(runtimeArtifactResumeHeaders(64, { Accept: "application/octet-stream" }), {
    Accept: "application/octet-stream",
    Range: "bytes=64-",
  });
});

test("runtime artifact rejects an oversized response before writing extra bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-runtime-oversized-"));
  const destination = path.join(directory, "runtime.whl");
  try {
    await assert.rejects(
      downloadVerifiedRuntimeArtifact({
        destination,
        expectedBytes: 2,
        expectedSha256: digest("ok"),
        sources: [{ url: "https://example.invalid/runtime.whl" }],
        attempts: 1,
        fetcher: async () => new Response("more than expected", { status: 200 }),
      }),
      /runtime_artifact_download_failed/,
    );
    const partialSize = await stat(`${destination}.part`)
      .then((value) => value.size)
      .catch(() => 0);
    assert.equal(partialSize <= 2, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime artifact requires a finite expected size before starting a download", async () => {
  await assert.rejects(
    downloadVerifiedRuntimeArtifact({
      destination: path.join(os.tmpdir(), "unused-shanghao-runtime.whl"),
      expectedBytes: Number.POSITIVE_INFINITY,
      expectedSha256: digest("ok"),
      sources: [{ url: "https://example.invalid/runtime.whl" }],
      fetcher: async () => {
        throw new Error("unexpected network request");
      },
    }),
    /runtime_artifact_size_invalid/,
  );
});
