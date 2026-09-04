import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("runtime artifact resume headers preserve source-specific headers", () => {
  assert.deepEqual(runtimeArtifactResumeHeaders(64, { Accept: "application/octet-stream" }), {
    Accept: "application/octet-stream",
    Range: "bytes=64-",
  });
});
