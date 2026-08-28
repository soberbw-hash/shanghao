import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export interface MediaByteRange {
  start: number;
  end: number;
}

export const parseMediaByteRange = (
  rangeHeader: string | null,
  fileSize: number,
): MediaByteRange | "unsatisfiable" | undefined => {
  if (!rangeHeader) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || fileSize <= 0) return "unsatisfiable";
  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (!rawStart && !rawEnd) return "unsatisfiable";

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "unsatisfiable";
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
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

interface ByteRangeMediaResponseOptions {
  contentType: string;
  cacheControl: string;
}

export const createByteRangeMediaResponse = async (
  filePath: string,
  rangeHeader: string | null,
  options: ByteRangeMediaResponseOptions,
): Promise<Response> => {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return new Response("Not found", { status: 404 });

  const range = parseMediaByteRange(rangeHeader, fileStat.size);
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": options.cacheControl,
    "Content-Type": options.contentType,
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
