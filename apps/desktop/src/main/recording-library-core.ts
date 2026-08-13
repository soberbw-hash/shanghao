import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import type {
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
  RecordingMarker,
} from "@private-voice/shared";

export const RECORDING_MEDIA_PROTOCOL = "shanghao-recording";
export const RECORDING_MEDIA_MIME_TYPE = "audio/mp4";
export const RECORDING_LIBRARY_METADATA_FILE = ".shanghao-library.json";

interface RecordingLibraryMetadata {
  favorites: string[];
}

export interface RecordingByteRange {
  start: number;
  end: number;
}

export const parseRecordingRange = (
  rangeHeader: string | null,
  fileSize: number,
): RecordingByteRange | "unsatisfiable" | undefined => {
  if (!rangeHeader) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || fileSize <= 0) return "unsatisfiable";
  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (!rawStart && !rawEnd) return "unsatisfiable";

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "unsatisfiable";
    const start = Math.max(0, fileSize - suffixLength);
    return { start, end: fileSize - 1 };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : fileSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= fileSize ||
    requestedEnd < start
  ) {
    return "unsatisfiable";
  }
  return { start, end: Math.min(requestedEnd, fileSize - 1) };
};

export const createRecordingMediaResponse = async (
  filePath: string,
  rangeHeader: string | null,
): Promise<Response> => {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return new Response("Not found", { status: 404 });
  const range = parseRecordingRange(rangeHeader, fileStat.size);
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": RECORDING_MEDIA_MIME_TYPE,
  };
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, "Content-Range": `bytes */${fileStat.size}` },
    });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, fileStat.size - 1);
  const contentLength = fileStat.size === 0 ? 0 : end - start + 1;
  const nodeStream = createReadStream(filePath, fileStat.size === 0 ? undefined : { start, end });
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: range ? 206 : 200,
    headers: {
      ...commonHeaders,
      "Content-Length": String(contentLength),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${fileStat.size}` } : {}),
    },
  });
};

export const markerPathFor = (filePath: string): string => {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-精彩时刻.txt`);
};

const metadataPathFor = (directory: string): string =>
  path.join(directory, RECORDING_LIBRARY_METADATA_FILE);

const readFavoriteFileNames = async (directory: string): Promise<Set<string>> => {
  try {
    const parsed = JSON.parse(
      await readFile(metadataPathFor(directory), "utf8"),
    ) as Partial<RecordingLibraryMetadata>;
    return new Set(
      Array.isArray(parsed.favorites)
        ? parsed.favorites.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
};

export const setRecordingFavoriteInDirectory = async (
  directory: string,
  filePath: string,
  isFavorite: boolean,
): Promise<void> => {
  if (!isAllowedRecordingPathInDirectory(directory, filePath)) {
    throw new Error("invalid_recording_path");
  }
  if (isFavorite) {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("recording_not_found");
  }

  await mkdir(directory, { recursive: true });
  const favorites = await readFavoriteFileNames(directory);
  const fileName = path.basename(filePath);
  if (isFavorite) favorites.add(fileName);
  else if (!favorites.delete(fileName)) return;

  const metadataPath = metadataPathFor(directory);
  const temporaryPath = `${metadataPath}.${process.pid}.tmp`;
  const metadata: RecordingLibraryMetadata = { favorites: [...favorites].sort() };
  await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await rename(temporaryPath, metadataPath);
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
  const favorites = await readFavoriteFileNames(directory);
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
          isFavorite: favorites.has(entry.name),
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
    await setRecordingFavoriteInDirectory(directory, item.filePath, false).catch(() => undefined);
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
  await setRecordingFavoriteInDirectory(directory, filePath, false).catch(() => undefined);
};

export const isAllowedRecordingPathInDirectory = (directory: string, filePath: string): boolean =>
  isInsideDirectory(directory, filePath) && path.extname(filePath).toLowerCase() === ".m4a";
