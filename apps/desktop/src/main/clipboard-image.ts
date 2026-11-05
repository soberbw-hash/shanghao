/** Use the Electron 44+ clipboard API while retaining compatibility with older runtimes. */
export async function writeClipboardImage(
  runtime: {
    clipboard: unknown;
    ClipboardItem?: unknown;
  },
  image: { toPNG(): Uint8Array },
): Promise<void> {
  const clipboard = runtime.clipboard as {
    writeImage?: (image: unknown) => void;
    write?: (items: unknown[]) => Promise<void>;
  };
  if (typeof runtime.ClipboardItem === "function" && typeof clipboard.write === "function") {
    const Item = runtime.ClipboardItem as new (items: Record<string, Blob>) => unknown;
    const png = Uint8Array.from(image.toPNG());
    await clipboard.write([new Item({ "image/png": new Blob([png], { type: "image/png" }) })]);
    return;
  }
  if (typeof clipboard.writeImage !== "function") throw Error("clipboard_image_unavailable");
  clipboard.writeImage(image);
}
