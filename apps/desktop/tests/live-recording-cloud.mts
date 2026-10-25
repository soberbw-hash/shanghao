// Manual opt-in: generated speech only; never run by the smoke suite.
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AiTranscriptionProviderStore } from "../src/main/ai-transcription-provider-store";
import {
  readBoundedProviderFile,
  recoverProviderPlaintext,
} from "../src/main/provider-encryption-recovery";
const report = (serialized: string) => process.stdout.write(`${serialized}\n`);

if (process.env.SHANGHAO_LIVE_RECORDING_PROBE !== "1") throw Error("manual_probe_opt_in_required");
const audioPath = await realpath(process.env.SHANGHAO_PROBE_AUDIO ?? "");
const relative = path.relative(os.tmpdir(), audioPath);
if (!/^shanghao-cloud-probe-[a-f0-9]+[\\/]speech\.wav$/i.test(relative))
  throw Error("generated_probe_audio_required");
const audio = await readFile(audioPath);
if (audio.length > 1024 * 1024) throw Error("probe_audio_too_large");
let byteRate = 0,
  dataBytes = 0;
for (let offset = 12; offset + 8 <= audio.length;) {
  const size = audio.readUInt32LE(offset + 4),
    name = audio.toString("ascii", offset, offset + 4);
  if (name === "fmt " && size >= 16) byteRate = audio.readUInt32LE(offset + 16);
  if (name === "data") dataBytes = size;
  offset += 8 + size + (size % 2);
}
const durationMs = Math.round((dataBytes / byteRate) * 1000);
if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 15000)
  throw Error("short_generated_probe_required");
const appData = process.env.APPDATA!;
const profile = path.join(appData, "shanghao-desktop");
const providerFile = path.join(profile, "ai", "transcription-provider.enc");
const encrypted = await readBoundedProviderFile(providerFile);
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const before = digest(encrypted);
let plaintext = await recoverProviderPlaintext(encrypted, appData);
if (!plaintext) throw Error("existing_provider_context_unavailable");
let httpStatus: number | undefined;
let providerCode: number | undefined;
const store = new AiTranscriptionProviderStore(
  profile,
  {
    isEncryptionAvailable: () => true,
    decryptString: () => plaintext!,
    encryptString: () => {
      throw Error("probe_must_not_write_credentials");
    },
  },
  async (input, init) => {
    if (String(input) !== "https://api.siliconflow.cn/v1/audio/transcriptions")
      throw Error("unexpected_probe_destination");
    const response = await fetch(input, init);
    httpStatus = response.status;
    if (!response.ok) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { code?: unknown };
      if (typeof body.code === "number") providerCode = body.code;
    }
    return response;
  },
);
const started = Date.now();
try {
  const result = await store.transcribe(audioPath, durationMs, "cloud", AbortSignal.timeout(45000));
  report(
    JSON.stringify({
      source: "generated_speech_only",
      durationMs,
      httpStatus,
      recognized: result.text.slice(0, 160),
      elapsedMs: Date.now() - started,
    }),
  );
} catch (error) {
  const code =
    error instanceof Error && /^[a-z0-9_:-]{1,120}$/i.test(error.message)
      ? error.message
      : "probe_request_failed";
  report(
    JSON.stringify({
      source: "generated_speech_only",
      durationMs,
      httpStatus,
      providerCode,
      errorCode: code,
      elapsedMs: Date.now() - started,
    }),
  );
  process.exitCode = 1;
} finally {
  plaintext = undefined;
  report(
    JSON.stringify({
      credentialFileUnchanged: before === digest(await readBoundedProviderFile(providerFile)),
    }),
  );
}
