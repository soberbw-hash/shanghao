import { stat } from "node:fs/promises";
import path from "node:path";

export async function developmentBundlesReady(directory) {
  const files = [
    "main/index.cjs",
    "main/app.cjs",
    "preload/index.cjs",
    "preload/overlay.cjs",
    "preload/screen-share-viewer.cjs",
  ];
  const states = await Promise.all(
    files.map(async (file) => {
      try {
        const entry = await stat(path.join(directory, "dist-electron", file));
        return entry.isFile() && entry.size > 0;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    }),
  );
  return states.every(Boolean);
}
