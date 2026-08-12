import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import type {
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
  RecordingMarker,
} from "@private-voice/shared";

export const RECORDING_MEDIA_PROTOCOL = "shanghao-recording";

export const markerPathFor = (filePath: string): string => {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-精彩时刻.txt`);
};

export const isInsideDirectory = (directory: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const parseMarkers = async (filePath: string): Promise<RecordingMarker[]> => {
  const source = await readFile(markerPathFor(filePath), "utf8").catch(() => "");
  const matches = [...source.matchAll(/(\d{2}):(\d{2}):(\d{2})/g)];
  return matches.map((match, index) => ({
    id: `${path.basename(filePath)}-${index}`,
    offsetMs: (Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])) * 1_000,
    createdAt: new Date(0).toISOString(),
  }));
};

export const toRecordingMediaUrl = (filePath: string): string =>
  `${RECORDING_MEDIA_PROTOCOL}://audio/${Buffer.from(filePath, "utf8").toString("base64url")}`;

export const decodeRecordingMediaUrl = (rawUrl: string): string | undefined => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== `${RECORDING_MEDIA_PROTOCOL}:` || url.hostname !== "audio")
      return undefined;
    const encoded = url.pathname.replace(/^\//, "");
    return encoded ? Buffer.from(encoded, "base64url").toString("utf8") : undefined;
  } catch {
    return undefined;
  }
};

export const readRecordingLibraryItems = async (
  directory: string,
): Promise<RecordingLibraryItem[]> => {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const items = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".m4a"))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const fileStat = await stat(filePath);
        const roomId = entry.name.includes("-一号房-")
          ? "main"
          : entry.name.includes("-二号房-")
            ? "side"
            : undefined;
        return {
          id: Buffer.from(entry.name, "utf8").toString("base64url"),
          fileName: entry.name,
          filePath,
          mediaUrl: toRecordingMediaUrl(filePath),
          createdAt: fileStat.birthtime.toISOString(),
          modifiedAt: fileStat.mtime.toISOString(),
          fileSize: fileStat.size,
          roomId,
          markers: await parseMarkers(filePath),
        } satisfies RecordingLibraryItem;
      }),
  );
  return items.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
};

export const readRecordingLibraryFromDirectory = async (
  directory: string,
  quotaGb: number,
): Promise<RecordingLibrarySnapshot> => {
  const items = await readRecordingLibraryItems(directory);
  return {
    directory,
    totalBytes: items.reduce((total, item) => total + item.fileSize, 0),
    quotaBytes: Math.round(Math.max(1, Math.min(100, quotaGb)) * 1024 ** 3),
    items,
  };
};

export const enforceRecordingQuotaInDirectory = async (
  directory: string,
  quotaGb: number,
): Promise<void> => {
  const snapshot = await readRecordingLibraryFromDirectory(directory, quotaGb);
  let totalBytes = snapshot.totalBytes;
  const oldestFirst = [...snapshot.items].reverse();
  while (totalBytes > snapshot.quotaBytes && oldestFirst.length > 1) {
    const item = oldestFirst.shift();
    if (!item) break;
    await unlink(item.filePath).catch(() => undefined);
    await unlink(markerPathFor(item.filePath)).catch(() => undefined);
    totalBytes -= item.fileSize;
  }
};

export const deleteRecordingInDirectory = async (
  directory: string,
  filePath: string,
): Promise<void> => {
  if (!isInsideDirectory(directory, filePath) || path.extname(filePath).toLowerCase() !== ".m4a") {
    throw new Error("invalid_recording_path");
  }
  await unlink(filePath);
  await unlink(markerPathFor(filePath)).catch(() => undefined);
};

export const isAllowedRecordingPathInDirectory = (directory: string, filePath: string): boolean =>
  isInsideDirectory(directory, filePath) && path.extname(filePath).toLowerCase() === ".m4a";
