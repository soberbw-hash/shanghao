import { mainResourceScheduler } from "./main-resource-scheduler";
import { resolveFfmpegExecutable } from "./media-runtime";
import { runLocalProcess } from "./local-process";

/** The recording owner keeps the input until this bounded encoder has fully exited. */
export const transcodeSavedRecording = (
  inputPath: string,
  outputPath: string,
  channels: number,
): Promise<void> =>
  mainResourceScheduler.runWork("recording-export", async (signal) => {
    const executable = resolveFfmpegExecutable();
    if (!executable) throw new Error("ffmpeg_missing");
    await runLocalProcess(
      executable,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-ar",
        "48000",
        "-ac",
        String(channels),
        "-c:a",
        "aac",
        "-b:a",
        "32k",
        "-threads",
        "1",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { signal, timeoutMs: 30 * 60_000 },
    );
  });
