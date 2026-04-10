import { spawn } from "node:child_process";
import { mkdir, stat, unlink, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { app, dialog } from "electron";

import type {
  RecordingExportPayload,
  RecordingExportResponse,
  RendererLogPayload,
} from "@private-voice/shared";

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
  writeLog: (payload: RendererLogPayload) => Promise<void>,
): Promise<RecordingExportResponse> => {
  const saveDialogResult = await dialog.showSaveDialog({
    title: "Save room recording",
    defaultPath: payload.suggestedFileName,
    filters: [{ name: "AAC recording", extensions: ["m4a"] }],
  });

  if (saveDialogResult.canceled || !saveDialogResult.filePath) {
    return {
      ok: false,
      errorMessage: "Recording save was canceled.",
    };
  }

  const tempDirectory = path.join(app.getPath("temp"), "quiet-team-recordings");
  await mkdir(tempDirectory, { recursive: true });

  const timestamp = Date.now().toString();
  const inputPath = path.join(
    tempDirectory,
    `recording-${timestamp}${inferExtensionFromMime(payload.sourceMimeType)}`,
  );

  await writeFile(inputPath, Buffer.from(payload.buffer));

  try {
    if (shouldCopyWithoutTranscode(payload.sourceMimeType)) {
      await copyFile(inputPath, saveDialogResult.filePath);
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
            saveDialogResult.filePath,
          ],
          {
            windowsHide: true,
            env: ffprobe.path
              ? {
                  ...process.env,
                  FFPROBE_PATH: ffprobe.path,
                }
              : process.env,
          },
        );

        ffmpeg.on("close", (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`ffmpeg exited with code ${code ?? -1}`));
        });
        ffmpeg.on("error", reject);
      });
    }

    const savedFile = await stat(saveDialogResult.filePath);
    await unlink(inputPath).catch(() => undefined);

    await writeLog({
      category: "recording",
      level: "info",
      message: "Recording export completed",
      context: {
        filePath: saveDialogResult.filePath,
        sampleRate: payload.sampleRate,
        sourceMimeType: payload.sourceMimeType,
        fileSize: savedFile.size,
      },
    });

    return {
      ok: true,
      filePath: saveDialogResult.filePath,
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
          ? `${error.message}. The temporary recording file was kept.`
          : "Recording export failed. The temporary recording file was kept.",
    };
  }
};
