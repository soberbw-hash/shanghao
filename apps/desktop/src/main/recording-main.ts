import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import type {
  RecordingExportPayload,
  RecordingExportResponse,
  RecordingStreamFinalizePayload,
  RendererLogPayload,
} from "@private-voice/shared";

import {
  createNumberedRecordingFileName,
  resolveAvailableRecordingPath,
  resolveUsableRecordingDirectory,
} from "./recording-path";
import { registerRecordingInDirectory } from "./recording-library-core";
import { resolveFfmpegExecutable } from "./media-runtime";

const RECORDING_AAC_BITRATE = "32k";
const STREAM_SESSION_DIRECTORY = "stream-sessions";
const MAX_RECORDING_CHUNK_BYTES = 8 * 1024 * 1024;

interface RecordingStreamSession {
  sessionId: string;
  inputPath: string;
  metadataPath: string;
  sourceMimeType: string;
  stream: WriteStream;
  bytesWritten: number;
  chunkCount: number;
  writeQueue: Promise<void>;
  streamError?: Error;
}

const streamSessions = new Map<string, RecordingStreamSession>();

const inferExtensionFromMime = (mimeType: string): string => {
  if (mimeType.includes("mp4") || mimeType.includes("aac")) {
    return ".m4a";
  }
  if (mimeType.includes("ogg")) {
    return ".ogg";
  }
  return ".webm";
};

const shouldCopyWithoutTranscode = (mimeType: string): boolean =>
  mimeType.includes("audio/mp4") || mimeType.includes("audio/aac");

export const exportRecordingFromMain = async (
  payload: RecordingExportPayload,
  configuredDirectory: string | undefined,
  writeLog: (payload: RendererLogPayload) => Promise<void>,
  inputPathOverride?: string,
): Promise<RecordingExportResponse> => {
  const recordingDirectory = await resolveUsableRecordingDirectory(
    configuredDirectory,
    app.getPath("documents"),
  );
  await mkdir(recordingDirectory, { recursive: true });
  const existingFileNames = (await readdir(recordingDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const designedFileName = createNumberedRecordingFileName(new Date(), existingFileNames);
  const outputPath = await resolveAvailableRecordingPath(
    recordingDirectory,
    designedFileName,
    async (candidate) =>
      stat(candidate)
        .then(() => true)
        .catch(() => false),
  );

  const tempDirectory = path.join(app.getPath("temp"), "shanghao-recordings");
  await mkdir(tempDirectory, { recursive: true });

  const timestamp = Date.now().toString();
  const inputPath =
    inputPathOverride ??
    path.join(
      tempDirectory,
      `recording-${timestamp}${inferExtensionFromMime(payload.sourceMimeType)}`,
    );

  if (!inputPathOverride) await writeFile(inputPath, Buffer.from(payload.buffer));

  try {
    if (shouldCopyWithoutTranscode(payload.sourceMimeType)) {
      await copyFile(inputPath, outputPath);
    } else {
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(
          resolveFfmpegExecutable() || "ffmpeg",
          [
            "-y",
            "-i",
            inputPath,
            "-ar",
            "48000",
            "-ac",
            `${payload.channels}`,
            "-c:a",
            "aac",
            "-b:a",
            RECORDING_AAC_BITRATE,
            "-movflags",
            "+faststart",
            outputPath,
          ],
          { windowsHide: true },
        );

        ffmpeg.on("close", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`ffmpeg 退出，错误代码 ${code ?? -1}`));
        });
        ffmpeg.on("error", reject);
      });
    }

    const savedFile = await stat(outputPath);
    const recordingId = await registerRecordingInDirectory(recordingDirectory, outputPath);
    await unlink(inputPath).catch(() => undefined);

    await writeLog({
      category: "recording",
      level: "info",
      message: "Recording export completed",
      context: {
        filePath: outputPath,
        sampleRate: payload.sampleRate,
        sourceMimeType: payload.sourceMimeType,
        fileSize: savedFile.size,
      },
    });

    return {
      ok: true,
      recordingId,
      filePath: outputPath,
      mimeType: "audio/mp4",
      fileSize: savedFile.size,
    };
  } catch (error) {
    await writeLog({
      category: "recording",
      level: "error",
      message: "Recording export failed",
      context: {
        error: error instanceof Error ? error.message : "Unknown export error",
        tempFilePath: inputPath,
      },
    });

    return {
      ok: false,
      keptTemporaryFilePath: inputPath,
      errorMessage:
        error instanceof Error
          ? `${error.message}。临时录音文件已保留。`
          : "录音导出失败，临时录音文件已保留。",
    };
  }
};

const streamSessionDirectory = (): string =>
  path.join(app.getPath("temp"), "shanghao-recordings", STREAM_SESSION_DIRECTORY);

const persistStreamSession = async (session: RecordingStreamSession): Promise<void> => {
  await writeFile(
    session.metadataPath,
    JSON.stringify({
      sessionId: session.sessionId,
      inputPath: session.inputPath,
      sourceMimeType: session.sourceMimeType,
      bytesWritten: session.bytesWritten,
      chunkCount: session.chunkCount,
      updatedAt: new Date().toISOString(),
      recoverable: true,
    }),
    "utf8",
  );
};

const closeStream = (stream: WriteStream): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(() => resolve());
  });

export const startRecordingSession = async (
  sourceMimeType: string,
): Promise<{ ok: boolean; sessionId?: string; errorMessage?: string }> => {
  if (!sourceMimeType || sourceMimeType.length > 160) {
    return { ok: false, errorMessage: "录音格式无效，无法创建流式会话。" };
  }
  const directory = streamSessionDirectory();
  await mkdir(directory, { recursive: true });
  const sessionId = randomUUID();
  const inputPath = path.join(
    directory,
    `${sessionId}.partial${inferExtensionFromMime(sourceMimeType)}`,
  );
  const session: RecordingStreamSession = {
    sessionId,
    inputPath,
    metadataPath: path.join(directory, `${sessionId}.json`),
    sourceMimeType,
    stream: createWriteStream(inputPath, { flags: "wx" }),
    bytesWritten: 0,
    chunkCount: 0,
    writeQueue: Promise.resolve(),
  };
  session.stream.on("error", (error) => {
    session.streamError = error instanceof Error ? error : new Error("录音临时文件写入失败。");
  });
  streamSessions.set(sessionId, session);
  await persistStreamSession(session);
  return { ok: true, sessionId };
};

export const appendRecordingChunk = async (
  sessionId: string,
  buffer: ArrayBuffer,
): Promise<void> => {
  const session = streamSessions.get(sessionId);
  if (!session) throw new Error("recording_stream_session_not_found");
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return;
  if (buffer.byteLength > MAX_RECORDING_CHUNK_BYTES) {
    throw new Error("recording_stream_chunk_too_large");
  }
  session.writeQueue = session.writeQueue.then(async () => {
    if (session.streamError) throw session.streamError;
    const chunk = Buffer.from(buffer);
    if (!session.stream.write(chunk)) {
      await new Promise<void>((resolve, reject) => {
        session.stream.once("drain", resolve);
        session.stream.once("error", reject);
      });
    }
    session.bytesWritten += chunk.byteLength;
    session.chunkCount += 1;
    if (session.chunkCount % 16 === 0) await persistStreamSession(session);
  });
  await session.writeQueue;
};

export const finalizeRecordingSession = async (
  payload: RecordingStreamFinalizePayload,
  configuredDirectory: string | undefined,
  writeLog: (payload: RendererLogPayload) => Promise<void>,
): Promise<RecordingExportResponse> => {
  const session = streamSessions.get(payload.sessionId);
  if (!session) return { ok: false, errorMessage: "录音流式会话不存在，无法完成保存。" };
  try {
    await session.writeQueue;
    await closeStream(session.stream);
    streamSessions.delete(payload.sessionId);
    const result = await exportRecordingFromMain(
      {
        buffer: new ArrayBuffer(0),
        sourceMimeType: session.sourceMimeType,
        sampleRate: payload.sampleRate,
        suggestedFileName: payload.suggestedFileName,
        channels: payload.channels,
        targetFormat: payload.targetFormat,
      },
      configuredDirectory,
      writeLog,
      session.inputPath,
    );
    if (result.ok) await rm(session.metadataPath, { force: true });
    return result;
  } catch (error) {
    return {
      ok: false,
      keptTemporaryFilePath: session.inputPath,
      errorMessage:
        error instanceof Error
          ? `${error.message}。临时录音文件已保留。`
          : "录音保存失败，临时录音文件已保留。",
    };
  }
};

export const abortRecordingSession = async (sessionId: string): Promise<void> => {
  const session = streamSessions.get(sessionId);
  if (!session) return;
  streamSessions.delete(sessionId);
  await session.writeQueue.catch(() => undefined);
  session.stream.destroy();
  await unlink(session.inputPath).catch(() => undefined);
  await unlink(session.metadataPath).catch(() => undefined);
};
