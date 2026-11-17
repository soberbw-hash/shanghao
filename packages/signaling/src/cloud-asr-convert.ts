import { spawn } from "node:child_process";

/** Convert one bounded WebM chunk in memory; never write room audio to disk. */
export async function convertChronicleWebm(audio: Buffer, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (!audio.length || audio.length > 12 * 1024 * 1024) throw Error("cloud_asr_conversion_failed");
  const limit = 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.SHANGHAO_ASR_FFMPEG || "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-protocol_whitelist",
        "pipe",
        "-f",
        "matroska",
        "-i",
        "pipe:0",
        "-t",
        "121",
        "-map",
        "0:a:0",
        "-c:a",
        "copy",
        "-f",
        "ogg",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    const parts: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) {
        child.kill();
        reject(error);
        return;
      }
      const output = Buffer.concat(parts);
      const head = output.indexOf("OpusHead");
      if (head < 0 || head > 128 || head + 12 > output.length || output[head + 9] !== 1) {
        reject(Error("cloud_asr_provider_format_unsupported"));
        return;
      }
      const preskip = output.readUInt16LE(head + 10);
      let offset = 0;
      let lastGranule = 0n;
      while (offset < output.length) {
        if (
          offset + 27 > output.length ||
          output.toString("ascii", offset, offset + 4) !== "OggS"
        ) {
          reject(Error("cloud_asr_conversion_failed"));
          return;
        }
        const count = output[offset + 26]!;
        if (offset + 27 + count > output.length) {
          reject(Error("cloud_asr_conversion_failed"));
          return;
        }
        let length = 27 + count;
        for (let i = 0; i < count; i++) length += output[offset + 27 + i]!;
        if (offset + length > output.length) {
          reject(Error("cloud_asr_conversion_failed"));
          return;
        }
        const granule = output.readBigUInt64LE(offset + 6);
        if (granule !== 0xffffffffffffffffn) lastGranule = granule;
        offset += length;
      }
      if (lastGranule <= BigInt(preskip) || lastGranule - BigInt(preskip) > 120n * 48000n) {
        reject(Error("cloud_asr_provider_format_unsupported"));
        return;
      }
      resolve(output);
    };
    const abort = () => finish(Error("cloud_asr_conversion_cancelled"));
    const timer = setTimeout(() => finish(Error("cloud_asr_conversion_failed")), 15000);
    timer.unref();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.on("error", () => finish(Error("cloud_asr_conversion_failed")));
    child.stdin.on("error", () => finish(Error("cloud_asr_conversion_failed")));
    child.stdout.on("error", () => finish(Error("cloud_asr_conversion_failed")));
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) finish(Error("cloud_asr_provider_format_unsupported"));
      else parts.push(chunk);
    });
    child.on("close", (code) =>
      finish(code === 0 && bytes > 0 ? undefined : Error("cloud_asr_conversion_failed")),
    );
    child.stdin.end(audio);
  });
}
