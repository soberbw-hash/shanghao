import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createByteRangeMediaResponse,
  parseMediaByteRange,
} from "../src/main/byte-range-media-response";

test("quick-message AAC responses stream complete files and byte ranges", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-quick-message-range-"));
  try {
    const filePath = path.join(directory, "music.aac");
    const bytes = Buffer.from(Array.from({ length: 64 }, (_, index) => index));
    await writeFile(filePath, bytes);

    assert.deepEqual(parseMediaByteRange("bytes=8-23", bytes.length), { start: 8, end: 23 });
    assert.deepEqual(parseMediaByteRange("bytes=-4", bytes.length), { start: 60, end: 63 });

    const complete = await createByteRangeMediaResponse(filePath, null, {
      contentType: "audio/aac",
      cacheControl: "public, max-age=31536000, immutable",
    });
    assert.equal(complete.status, 200);
    assert.equal(complete.headers.get("accept-ranges"), "bytes");
    assert.equal(complete.headers.get("content-length"), "64");
    assert.deepEqual(Buffer.from(await complete.arrayBuffer()), bytes);

    const partial = await createByteRangeMediaResponse(filePath, "bytes=8-23", {
      contentType: "audio/aac",
      cacheControl: "public, max-age=31536000, immutable",
    });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-type"), "audio/aac");
    assert.equal(partial.headers.get("content-range"), "bytes 8-23/64");
    assert.equal(partial.headers.get("content-length"), "16");
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(8, 24));

    const invalid = await createByteRangeMediaResponse(filePath, "bytes=99-120", {
      contentType: "audio/aac",
      cacheControl: "no-store",
    });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */64");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
