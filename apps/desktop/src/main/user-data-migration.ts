import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_ID = "pre-3.0-recording-identity-v1";
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const RETAIN_SNAPSHOTS = 3;

interface SnapshotEntry {
  source: string;
  relativePath: string;
  size: number;
  sha256: string;
}

interface SnapshotManifest {
  schemaVersion: 1;
  snapshotId: string;
  createdAt: string;
  entries: SnapshotEntry[];
  skipped: Array<{ source: string; reason: string }>;
}

const digest = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");

const collectFiles = async (candidate: string): Promise<string[]> => {
  const info = await stat(candidate).catch(() => undefined);
  if (!info) return [];
  if (info.isFile()) return [candidate];
  if (!info.isDirectory()) return [];
  const entries = await readdir(candidate, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => collectFiles(path.join(candidate, entry.name))),
  );
  return nested.flat();
};

const safeLabel = (value: string): string =>
  value.replace(/^[A-Za-z]:/, "drive").replace(/[\\/:*?"<>|]+/g, "_");

/** Creates a bounded, verified, one-time snapshot before 3.0 metadata migration. */
export const ensurePre30DataSnapshot = async (options: {
  userDataDirectory: string;
  recordingDirectory: string;
  log?: (message: string, context?: Record<string, unknown>) => void;
}): Promise<void> => {
  const root = path.join(options.userDataDirectory, "migration-snapshots");
  const marker = path.join(root, `${SNAPSHOT_ID}.complete.json`);
  if (
    await stat(marker)
      .then(() => true)
      .catch(() => false)
  )
    return;
  const staging = path.join(root, `${SNAPSHOT_ID}.${process.pid}.staging`);
  const committed = path.join(root, `${SNAPSHOT_ID}-${Date.now()}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const userDataCandidates = [
    "settings.json",
    "settings.backup.json",
    "chat-history.json",
    "daily-room-reports.json",
    "voice-memory",
    "Local Storage",
  ].map((name) => path.join(options.userDataDirectory, name));
  const recordingEntries = await readdir(options.recordingDirectory, { withFileTypes: true }).catch(
    () => [],
  );
  const recordingCandidates = recordingEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name === ".shanghao-library.json" || entry.name.endsWith("-精彩时刻.txt")),
    )
    .map((entry) => path.join(options.recordingDirectory, entry.name));
  const files = (
    await Promise.all([...userDataCandidates, ...recordingCandidates].map(collectFiles))
  ).flat();
  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    snapshotId: SNAPSHOT_ID,
    createdAt: new Date().toISOString(),
    entries: [],
    skipped: [],
  };
  let totalBytes = 0;
  try {
    for (const source of files) {
      const info = await stat(source);
      if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_SNAPSHOT_BYTES) {
        manifest.skipped.push({ source, reason: "snapshot_size_limit" });
        continue;
      }
      const relativePath = safeLabel(path.relative(options.userDataDirectory, source));
      const target = path.join(staging, "data", relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      const [sourceHash, targetHash] = await Promise.all([digest(source), digest(target)]);
      if (sourceHash !== targetHash) throw new Error(`snapshot_hash_mismatch:${source}`);
      manifest.entries.push({ source, relativePath, size: info.size, sha256: sourceHash });
      totalBytes += info.size;
    }
    await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    await rename(staging, committed);
    await writeFile(marker, JSON.stringify({ snapshot: committed, ...manifest }, null, 2), "utf8");
    const snapshots = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${SNAPSHOT_ID}-`))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    await Promise.all(
      snapshots
        .slice(RETAIN_SNAPSHOTS)
        .map((entry) => rm(path.join(root, entry), { recursive: true, force: true })),
    );
    options.log?.("pre-3.0 data snapshot committed", {
      files: manifest.entries.length,
      bytes: totalBytes,
      skipped: manifest.skipped.length,
    });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    options.log?.("pre-3.0 data snapshot failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
