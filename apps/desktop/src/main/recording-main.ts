import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
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
  reserveAvailableRecordingPath,
  resolveUsableRecordingDirectory,
} from "./recording-path";
import { registerRecordingInDirectory } from "./recording-library-core";
import { transcodeSavedRecording } from "./recording-transcode";

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
  finalizePromise?: Promise<RecordingExportResponse>;
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
  const tempDirectory = path.join(app.getPath("temp"), "shanghao-recordings");
  await mkdir(tempDirectory, { recursive: true });
  const outputPath = await reserveAvailableRecordingPath(recordingDirectory, designedFileName);

  const inputPath =
    inputPathOverride ??
    path.join(
      tempDirectory,
      `recording-${randomUUID()}${inferExtensionFromMime(payload.sourceMimeType)}`,
    );

  let outputComplete = false;
  try {
    if (!inputPathOverride) await writeFile(inputPath, Buffer.from(payload.buffer), { flag: "wx" });
    if (shouldCopyWithoutTranscode(payload.sourceMimeType)) {
      await copyFile(inputPath, outputPath);
    } else {
      await transcodeSavedRecording(inputPath, outputPath, payload.channels);
    }

    const savedFile = await stat(outputPath);
    outputComplete = true;
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
    }).catch(() => undefined);

    return {
      ok: true,
      recordingId,
      filePath: outputPath,
      mimeType: "audio/mp4",
      fileSize: savedFile.size,
    };
  } catch (error) {
    if (!outputComplete) await rm(outputPath, { force: true }).catch(() => undefined);
    await writeLog({
      category: "recording",
      level: "error",
      message: "Recording export failed",
      context: {
        error: error instanceof Error ? error.message : "Unknown export error",
        tempFilePath: inputPath,
      },
    }).catch(() => undefined);

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
  const temporary = `${session.metadataPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        sessionId: session.sessionId,
        inputPath: session.inputPath,
        sourceMimeType: session.sourceMimeType,
        bytesWritten: session.bytesWritten,
        chunkCount: session.chunkCount,
        updatedAt: new Date().toISOString(),
        recoverable: true,
      }),
      { encoding: "utf8", flag: "wx" },
    );
    await rename(temporary, session.metadataPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
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
  try {
    await persistStreamSession(session);
  } catch (error) {
    await sealRecordingSession(sessionId).catch(() => undefined);
    throw error;
  }
  return { ok: true, sessionId };
};

export const appendRecordingChunk = async (
  sessionId: string,
  buffer: ArrayBuffer,
): Promise<void> => {
  const session = streamSessions.get(sessionId);
  if (!session) throw new Error("recording_stream_session_not_found");
  if (session.finalizePromise) throw new Error("recording_stream_finalizing");
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

export const finalizeRecordingSession = (
  payload: RecordingStreamFinalizePayload,
  configuredDirectory: string | undefined,
  writeLog: (payload: RendererLogPayload) => Promise<void>,
): Promise<RecordingExportResponse> => {
  const session = streamSessions.get(payload.sessionId);
  if (!session)
    return Promise.resolve({ ok: false, errorMessage: "录音流式会话不存在，无法完成保存。" });
  if (session.finalizePromise) return session.finalizePromise;
  const operation = finalizeRecordingSessionOnce(session, payload, configuredDirectory, writeLog);
  session.finalizePromise = operation;
  void operation
    .finally(() => {
      if (streamSessions.get(payload.sessionId) === session)
        streamSessions.delete(payload.sessionId);
    })
    .catch(() => undefined);
  return operation;
};

const finalizeRecordingSessionOnce = async (
  session: RecordingStreamSession,
  payload: RecordingStreamFinalizePayload,
  configuredDirectory: string | undefined,
  writeLog: (payload: RendererLogPayload) => Promise<void>,
): Promise<RecordingExportResponse> => {
  try {
    await session.writeQueue;
    await closeStream(session.stream);
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
    await sealSessionContents(session).catch(() => undefined);
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

const sealSessionContents = async (session: RecordingStreamSession): Promise<void> => {
  await session.writeQueue.catch(() => undefined);
  if (!session.stream.destroyed) {
    await closeStream(session.stream).catch(() => session.stream.destroy());
  }
  await persistStreamSession(session).catch(() => undefined);
};

/** Closes a broken writer without removing its recoverable input or metadata. */
export const sealRecordingSession = async (sessionId: string): Promise<void> => {
  const session = streamSessions.get(sessionId);
  if (!session) return;
  if (session.finalizePromise) {
    await session.finalizePromise;
    return;
  }
  streamSessions.delete(sessionId);
  await sealSessionContents(session);
};

export const abortRecordingSession = async (sessionId: string): Promise<void> => {
  const session = streamSessions.get(sessionId);
  if (!session) return;
  if (session.finalizePromise) {
    await session.finalizePromise;
    return;
  }
  streamSessions.delete(sessionId);
  await session.writeQueue.catch(() => undefined);
  session.stream.destroy();
  await unlink(session.inputPath).catch(() => undefined);
  await unlink(session.metadataPath).catch(() => undefined);
};
