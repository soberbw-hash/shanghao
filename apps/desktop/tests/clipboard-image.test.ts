import assert from "node:assert/strict";
import test from "node:test";
import { writeClipboardImage } from "../src/main/clipboard-image";

test("new Electron clipboard receives only validated PNG bytes and is awaited", async () => {
  let payload: Record<string, Blob> | undefined;
  let release!: () => void;
  class ClipboardItem {
    constructor(items: Record<string, Blob>) {
      payload = items;
    }
  }
  const writing = writeClipboardImage(
    {
      ClipboardItem,
      clipboard: {
        write: async () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    },
    { toPNG: () => Uint8Array.of(1, 2, 3) },
  );
  let finished = false;
  void writing.then(() => {
    finished = true;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.deepEqual(Object.keys(payload!), ["image/png"]);
  assert.deepEqual(
    new Uint8Array(await payload!["image/png"]!.arrayBuffer()),
    Uint8Array.of(1, 2, 3),
  );
  release();
  await writing;
  assert.equal(finished, true);
});

test("old Electron uses the existing native image and missing APIs fail clearly", async () => {
  const image = { toPNG: () => Uint8Array.of(1) };
  let written: unknown;
  await writeClipboardImage(
    {
      clipboard: {
        writeImage: (value: unknown) => {
          written = value;
        },
      },
    },
    image,
  );
  assert.equal(written, image);
  await assert.rejects(
    writeClipboardImage({ clipboard: {} }, image),
    /clipboard_image_unavailable/,
  );
});
