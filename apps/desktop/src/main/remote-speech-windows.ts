import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

interface PcmData {
  samples: Buffer;
  rate: number;
}
function pcmData(wav: Buffer): PcmData {
  let rate = 0,
    samples: Buffer | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4),
      kind = wav.toString("ascii", offset, offset + 4);
    if (size > wav.length - offset - 8) throw Error("invalid_cloud_pcm");
    if (kind === "fmt ") {
      if (
        size < 16 ||
        wav.readUInt16LE(offset + 8) !== 1 ||
        wav.readUInt16LE(offset + 10) !== 1 ||
        wav.readUInt16LE(offset + 22) !== 16
      )
        throw Error("invalid_cloud_pcm");
      rate = wav.readUInt32LE(offset + 12);
    }
    if (kind === "data") samples = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!rate || !samples || samples.length % 2) throw Error("invalid_cloud_pcm");
  return { samples, rate };
}

/** Conservative energy windows, not diarization or forced alignment. Quiet audio is retained. */
export function cloudSpeechWindows(wav: Buffer): Array<{ startMs: number; endMs: number }> {
  const { samples, rate } = pcmData(wav),
    duration = (samples.length / 2 / rate) * 1000;
  if (duration > 30100) throw Error("cloud_pcm_window_too_large");
  const frames: number[] = [],
    frameSamples = Math.max(1, Math.round(rate * 0.02));
  let peak = 0;
  for (let first = 0; first < samples.length / 2; first += frameSamples) {
    let sum = 0;
    const end = Math.min(samples.length / 2, first + frameSamples);
    for (let i = first; i < end; i++) {
      const value = Math.abs(samples.readInt16LE(i * 2)) / 32768;
      peak = Math.max(peak, value);
      sum += value * value;
    }
    frames.push(Math.sqrt(sum / (end - first)));
  }
  if (!peak) return []; // Only exact digital silence is discarded without ASR.
  const active = frames.flatMap((rms, index) => (rms >= 0.001 ? [index] : []));
  if (!active.length) return [{ startMs: 0, endMs: duration }];
  const groups: Array<{ startMs: number; endMs: number }> = [];
  for (const index of active) {
    const startMs = Math.max(0, index * 20 - 150),
      endMs = Math.min(duration, (index + 1) * 20 + 250);
    const previous = groups.at(-1);
    if (previous && startMs - previous.endMs <= 700 && endMs - previous.startMs <= 18000)
      previous.endMs = endMs;
    else if (previous && startMs < previous.endMs) groups.push({ startMs: previous.endMs, endMs });
    else groups.push({ startMs, endMs });
  }
  return groups;
}

function sliceWav(input: PcmData, startMs: number, endMs: number): Buffer {
  const first = Math.floor((startMs / 1000) * input.rate) * 2,
    last = Math.ceil((endMs / 1000) * input.rate) * 2;
  const data = input.samples.subarray(first, last),
    wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(input.rate, 24);
  wav.writeUInt32LE(input.rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

/** Bind each plain-text reply to its actual audio window, never invented punctuation timings. */
export async function transcribeCloudSpeechWindows(
  file: string,
  signal: AbortSignal,
  send: (file: string, duration: number) => Promise<{ text: string; modelName: string }>,
) {
  signal.throwIfAborted();
  const wav = await readFile(file),
    pcm = pcmData(wav),
    windows = cloudSpeechWindows(wav);
  if (!windows.length)
    return { text: "", modelName: "FunAudioLLM/SenseVoiceSmall", emptyRechecked: true };
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-speech-windows-"));
  let modelName = "FunAudioLLM/SenseVoiceSmall";
  const rows: Array<{ Start: number; End: number; Content: string; Speaker: number }> = [];
  try {
    for (const [index, window] of windows.entries()) {
      signal.throwIfAborted();
      const slice = path.join(directory, `${index}.wav`);
      await writeFile(slice, sliceWav(pcm, window.startMs, window.endMs));
      const reply = await send(slice, window.endMs - window.startMs);
      signal.throwIfAborted();
      modelName = reply.modelName;
      if (reply.text.trim())
        rows.push({
          Start: window.startMs / 1000,
          End: window.endMs / 1000,
          Content: reply.text.trim(),
          Speaker: 1,
        });
    }
    return { text: rows.length ? JSON.stringify(rows) : "", modelName, emptyRechecked: true };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
