import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writePrivateFileAtomically } from "../src/main/atomic-private-file";

test("private file replacement keeps the previous bytes when rename fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-private-write-failure-"));
  const destination = path.join(directory, "account-session.bin");
  try {
    await mkdir(destination);
    await writeFile(path.join(destination, "original"), "old private data");
    await assert.rejects(writePrivateFileAtomically(destination, Buffer.from("new private data")));
    assert.equal(await readFile(path.join(destination, "original"), "utf8"), "old private data");
    assert.deepEqual(await readdir(directory), ["account-session.bin"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("private file replacement writes only the verified destination", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-private-write-success-"));
  const destination = path.join(directory, "account-session.bin");
  try {
    await writeFile(destination, "old private data");
    await writePrivateFileAtomically(destination, Buffer.from("new private data"));
    assert.equal(await readFile(destination, "utf8"), "new private data");
    assert.deepEqual(await readdir(directory), ["account-session.bin"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
