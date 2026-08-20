import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
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

interface RecordingCatalogEntry {
  recordingId: string;
  fileName: string;
  title: string;
  createdAt: string;
}

interface RecordingLibraryMetadata {
  version?: 1 | 2;
  favorites: string[];
  favoriteRecordingIds?: string[];
  recordings?: RecordingCatalogEntry[];
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

const emptyMetadata = (): RecordingLibraryMetadata => ({
  version: 2,
  favorites: [],
  favoriteRecordingIds: [],
  recordings: [],
});

const readLibraryMetadata = async (directory: string): Promise<RecordingLibraryMetadata> => {
  try {
    const parsed = JSON.parse(
      await readFile(metadataPathFor(directory), "utf8"),
    ) as Partial<RecordingLibraryMetadata>;
    return {
      version: 2,
      favorites: Array.isArray(parsed.favorites)
        ? parsed.favorites.filter((value): value is string => typeof value === "string")
        : [],
      favoriteRecordingIds: Array.isArray(parsed.favoriteRecordingIds)
        ? parsed.favoriteRecordingIds.filter((value): value is string => typeof value === "string")
        : [],
      recordings: Array.isArray(parsed.recordings)
        ? parsed.recordings.filter((entry): entry is RecordingCatalogEntry =>
            Boolean(
              entry &&
              typeof entry.recordingId === "string" &&
              typeof entry.fileName === "string" &&
              typeof entry.title === "string" &&
              typeof entry.createdAt === "string",
            ),
          )
        : [],
    };
  } catch {
    return emptyMetadata();
  }
};

const writeLibraryMetadata = async (
  directory: string,
  metadata: RecordingLibraryMetadata,
): Promise<void> => {
  await mkdir(directory, { recursive: true });
  const metadataPath = metadataPathFor(directory);
  const temporaryPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ ...metadata, version: 2 }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, metadataPath);
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
  const metadata = await readLibraryMetadata(directory);
  const fileName = path.basename(filePath);
  const entry = metadata.recordings?.find((recording) => recording.fileName === fileName);
  const favoriteIds = new Set(metadata.favoriteRecordingIds ?? []);
  const legacyFavorites = new Set(metadata.favorites);
  if (entry) {
    if (isFavorite) favoriteIds.add(entry.recordingId);
    else favoriteIds.delete(entry.recordingId);
  }
  if (isFavorite) legacyFavorites.add(fileName);
  else legacyFavorites.delete(fileName);
  metadata.favoriteRecordingIds = [...favoriteIds].sort();
  metadata.favorites = [...legacyFavorites].sort();
  await writeLibraryMetadata(directory, metadata);
};

export const isInsideDirectory = (directory: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const parseMarkers = async (filePath: string, recordingId: string): Promise<RecordingMarker[]> => {
  const source = await readFile(markerPathFor(filePath), "utf8").catch(() => "");
  const matches = [...source.matchAll(/(\d{2}):(\d{2}):(\d{2})/g)];
  return matches.map((match, index) => ({
    id: `${recordingId}-${index}`,
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
  const metadata = await readLibraryMetadata(directory);
  const recordings = [...(metadata.recordings ?? [])];
  const byFileName = new Map(recordings.map((entry) => [entry.fileName, entry]));
  const legacyFavorites = new Set(metadata.favorites);
  const favoriteRecordingIds = new Set(metadata.favoriteRecordingIds ?? []);
  let metadataChanged = metadata.version !== 2;
  const items = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".m4a"))
      .map(async (entry) => {
        const filePath = path.join(directory, entry.name);
        const fileStat = await stat(filePath);
        let catalogEntry = byFileName.get(entry.name);
        if (!catalogEntry) {
          catalogEntry = {
            recordingId: randomUUID(),
            fileName: entry.name,
            title: path.parse(entry.name).name,
            createdAt: fileStat.birthtime.toISOString(),
          };
          recordings.push(catalogEntry);
          byFileName.set(entry.name, catalogEntry);
          metadataChanged = true;
        }
        if (
          legacyFavorites.has(entry.name) &&
          !favoriteRecordingIds.has(catalogEntry.recordingId)
        ) {
          favoriteRecordingIds.add(catalogEntry.recordingId);
          metadataChanged = true;
        }
        const roomId = entry.name.includes("-一号房-")
          ? "main"
          : entry.name.includes("-二号房-")
            ? "side"
            : undefined;
        return {
          id: catalogEntry.recordingId,
          recordingId: catalogEntry.recordingId,
          title: catalogEntry.title,
          fileName: entry.name,
          filePath,
          mediaUrl: toRecordingMediaUrl(filePath),
          createdAt: catalogEntry.createdAt,
          modifiedAt: fileStat.mtime.toISOString(),
          fileSize: fileStat.size,
          roomId,
          isFavorite: favoriteRecordingIds.has(catalogEntry.recordingId),
          markers: await parseMarkers(filePath, catalogEntry.recordingId),
        } satisfies RecordingLibraryItem;
      }),
  );
  if (metadataChanged) {
    await writeLibraryMetadata(directory, {
      version: 2,
      favorites: [...legacyFavorites].sort(),
      favoriteRecordingIds: [...favoriteRecordingIds].sort(),
      recordings,
    });
  }
  return items.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      left.recordingId.localeCompare(right.recordingId),
  );
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

export const registerRecordingInDirectory = async (
  directory: string,
  filePath: string,
): Promise<string> => {
  if (!isAllowedRecordingPathInDirectory(directory, filePath)) {
    throw new Error("invalid_recording_path");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("recording_not_found");
  const metadata = await readLibraryMetadata(directory);
  const fileName = path.basename(filePath);
  const existing = metadata.recordings?.find((entry) => entry.fileName === fileName);
  if (existing) return existing.recordingId;
  const entry: RecordingCatalogEntry = {
    recordingId: randomUUID(),
    fileName,
    title: path.parse(fileName).name,
    createdAt: fileStat.birthtime.toISOString(),
  };
  metadata.recordings = [...(metadata.recordings ?? []), entry];
  await writeLibraryMetadata(directory, metadata);
  return entry.recordingId;
};

const validateRecordingTitle = (value: string): string => {
  const title = value.trim();
  if (!title || title.length > 120) throw new Error("invalid_recording_title");
  const hasControlCharacter = Array.from(title).some((character) => character.charCodeAt(0) <= 31);
  if (/[<>:"/\\|?*]/.test(title) || hasControlCharacter || /[. ]$/.test(title)) {
    throw new Error("invalid_recording_title");
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(title)) {
    throw new Error("invalid_recording_title");
  }
  return title;
};

const resolveRenamedPath = async (
  directory: string,
  title: string,
  currentPath: string,
): Promise<string> => {
  for (let index = 1; index < 10_000; index += 1) {
    const suffix = index === 1 ? "" : ` (${index})`;
    const candidate = path.join(directory, `${title}${suffix}.m4a`);
    if (path.resolve(candidate).toLowerCase() === path.resolve(currentPath).toLowerCase()) {
      return candidate;
    }
    const exists = await stat(candidate)
      .then(() => true)
      .catch(() => false);
    if (!exists) return candidate;
  }
  throw new Error("recording_name_conflict");
};

export const renameRecordingInDirectory = async (
  directory: string,
  recordingId: string,
  requestedTitle: string,
): Promise<RecordingLibraryItem> => {
  const title = validateRecordingTitle(requestedTitle.replace(/\.m4a$/i, ""));
  const metadata = await readLibraryMetadata(directory);
  const catalogEntry = metadata.recordings?.find((entry) => entry.recordingId === recordingId);
  if (!catalogEntry) throw new Error("recording_not_found");
  const sourcePath = path.join(directory, catalogEntry.fileName);
  if (!isAllowedRecordingPathInDirectory(directory, sourcePath)) {
    throw new Error("invalid_recording_path");
  }
  const targetPath = await resolveRenamedPath(directory, title, sourcePath);
  const sourceMarkerPath = markerPathFor(sourcePath);
  const targetMarkerPath = markerPathFor(targetPath);
  const markerExists = await stat(sourceMarkerPath)
    .then((value) => value.isFile())
    .catch(() => false);
  const originalEntry = { ...catalogEntry };
  const legacyFavorites = new Set(metadata.favorites);
  const wasLegacyFavorite = legacyFavorites.delete(catalogEntry.fileName);
  if (wasLegacyFavorite) legacyFavorites.add(path.basename(targetPath));
  let audioRenamed = false;
  let markerRenamed = false;
  try {
    if (path.resolve(sourcePath).toLowerCase() !== path.resolve(targetPath).toLowerCase()) {
      await rename(sourcePath, targetPath);
      audioRenamed = true;
      if (markerExists) {
        await rename(sourceMarkerPath, targetMarkerPath);
        markerRenamed = true;
      }
    }
    catalogEntry.fileName = path.basename(targetPath);
    catalogEntry.title = title;
    metadata.favorites = [...legacyFavorites].sort();
    await writeLibraryMetadata(directory, metadata);
  } catch (error) {
    catalogEntry.fileName = originalEntry.fileName;
    catalogEntry.title = originalEntry.title;
    if (markerRenamed) await rename(targetMarkerPath, sourceMarkerPath).catch(() => undefined);
    if (audioRenamed) await rename(targetPath, sourcePath).catch(() => undefined);
    throw error;
  }
  const [item] = (await readRecordingLibraryItems(directory)).filter(
    (candidate) => candidate.recordingId === recordingId,
  );
  if (!item) throw new Error("recording_rename_verification_failed");
  return item;
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
    await deleteRecordingInDirectory(directory, item.filePath).catch(() => undefined);
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
  const metadata = await readLibraryMetadata(directory);
  const fileName = path.basename(filePath);
  const entry = metadata.recordings?.find((recording) => recording.fileName === fileName);
  metadata.recordings = metadata.recordings?.filter((recording) => recording.fileName !== fileName);
  metadata.favorites = metadata.favorites.filter((favorite) => favorite !== fileName);
  if (entry) {
    metadata.favoriteRecordingIds = metadata.favoriteRecordingIds?.filter(
      (recordingId) => recordingId !== entry.recordingId,
    );
  }
  await writeLibraryMetadata(directory, metadata).catch(() => undefined);
};

export const isAllowedRecordingPathInDirectory = (directory: string, filePath: string): boolean =>
  isInsideDirectory(directory, filePath) && path.extname(filePath).toLowerCase() === ".m4a";
