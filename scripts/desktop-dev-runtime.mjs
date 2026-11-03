import { stat, readdir } from "node:fs/promises";
import path from "node:path";

async function newestRuntimeSource(directory) {
  let newest = 0;
  const workspace =
    path.basename(directory) === "desktop" && path.basename(path.dirname(directory)) === "apps"
      ? path.resolve(directory, "../..")
      : undefined;
  const folders = [path.join(directory, "src", "main"), path.join(directory, "src", "preload")];
  const configuration = ["tsup.config.ts", "tsconfig.json", "package.json"].map((file) =>
    path.join(directory, file),
  );
  if (workspace) {
    for (const name of ["shared", "signaling"]) {
      folders.push(path.join(workspace, "packages", name, "src"));
      configuration.push(path.join(workspace, "packages", name, "package.json"));
    }
    configuration.push(
      ...["pnpm-lock.yaml", "tsconfig.base.json", "package.json"].map((file) =>
        path.join(workspace, file),
      ),
    );
  }
  for (const file of configuration) {
    try {
      newest = Math.max(newest, (await stat(file)).mtimeMs);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const folder of folders) {
    const pending = [folder];
    while (pending.length) {
      const current = pending.pop();
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) {
        const file = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(file);
        else if (entry.isFile() && /\.(?:ts|json)$/.test(entry.name))
          newest = Math.max(newest, (await stat(file)).mtimeMs);
      }
    }
  }
  return newest;
}

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
        return entry.isFile() && entry.size > 0 ? entry.mtimeMs : undefined;
      } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
    }),
  );
  if (states.some((state) => state === undefined)) return false;
  return Math.min(...states) >= (await newestRuntimeSource(directory));
}
