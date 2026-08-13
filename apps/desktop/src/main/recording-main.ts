import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";
import { app } from "electron";

import type {
  RecordingExportPayload,
  RecordingExportResponse,
  RendererLogPayload,
} from "@private-voice/shared";

import {
  createNumberedRecordingFileName,
  resolveAvailableRecordingPath,
  resolveRecordingDirectory,
} from "./recording-path";

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
): Promise<RecordingExportResponse> => {
  const recordingDirectory = resolveRecordingDirectory(
    configuredDirectory,
    app.getPath("documents"),
  );
  await mkdir(recordingDirectory, { recursive: true });
  const roomLabel = payload.suggestedFileName.includes("二号房")
    ? "二号房"
    : payload.suggestedFileName.includes("一号房")
      ? "一号房"
      : undefined;
  const existingFileNames = roomLabel
    ? (await readdir(recordingDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    : [];
  const designedFileName = roomLabel
    ? createNumberedRecordingFileName(roomLabel, new Date(), existingFileNames)
    : payload.suggestedFileName;
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
  const inputPath = path.join(
    tempDirectory,
    `recording-${timestamp}${inferExtensionFromMime(payload.sourceMimeType)}`,
  );

  await writeFile(inputPath, Buffer.from(payload.buffer));

  try {
    if (shouldCopyWithoutTranscode(payload.sourceMimeType)) {
      await copyFile(inputPath, outputPath);
    } else {
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn(
          ffmpegPath || "ffmpeg",
          [
            "-y",
            "-i",
            inputPath,
            "-ar",
            "44100",
            "-ac",
            `${payload.channels}`,
            "-c:a",
            "aac",
            "-b:a",
            "160k",
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
