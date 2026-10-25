// Explicit manual diagnostic for the user-selected recording; never part of smoke.
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { AiTranscriptionProviderStore } from "../src/main/ai-transcription-provider-store";
import { loadRemoteTranscriptionSources } from "../src/main/remote-transcription-sources";
import { transcribeRemoteParts } from "../src/main/remote-transcription-parts";
import {
  readBoundedProviderFile,
  recoverProviderPlaintext,
} from "../src/main/provider-encryption-recovery";
import type { VoiceMemoryRecord } from "@private-voice/shared";
import { transcribeWithRemoteProvider } from "../src/main/remote-transcription";
import assert from "node:assert/strict";
if (process.env.SHANGHAO_LIVE_PARTICIPANT_PROBE !== "1")
  throw Error("manual_probe_opt_in_required");
const id = "005bf212-3f0a-435a-963d-cbf4be83d64c";
const appData = process.env.APPDATA!;
const record = JSON.parse(
  await readFile(path.join(appData, "shanghao", "voice-memory", "records", `${id}.json`), "utf8"),
) as VoiceMemoryRecord;
const sources = (await loadRemoteTranscriptionSources(
  record,
  record.remoteTranscription!.audioDurationMs,
  AbortSignal.timeout(10000),
))!;
const source = sources.find(
  (item) => !record.remoteTranscription!.parts.some((part) => part.sourceId === item.id),
)!;
if (!source) throw Error("missing_failed_source");
const profile = path.join(appData, "shanghao-desktop");
const providerFile = path.join(profile, "ai", "transcription-provider.enc");
const encrypted = await readBoundedProviderFile(providerFile);
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
let plaintext = await recoverProviderPlaintext(encrypted, appData);
if (!plaintext) throw Error("existing_provider_context_unavailable");
let httpStatus: number | undefined, providerCode: number | undefined;
let requests = 0;
const store = new AiTranscriptionProviderStore(
  profile,
  {
    isEncryptionAvailable: () => true,
    decryptString: () => plaintext!,
    encryptString: () => {
      throw Error("read_only_probe");
    },
  },
  async (input, init) => {
    if (++requests > 24) throw Error("manual_probe_request_limit");
    if (String(input) !== "https://api.siliconflow.cn/v1/audio/transcriptions")
      throw Error("unexpected_destination");
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
const stop = new AbortController();
const signal = AbortSignal.any([AbortSignal.timeout(90000), stop.signal]);
const started = Date.now();
// Encoder already creates and removes its own temporary files. No source recordings are changed.
const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-user-track-probe-"));
try {
  if (process.env.SHANGHAO_PROBE_MULTI === "1") {
    let observed: VoiceMemoryRecord | undefined;
    try {
      await transcribeWithRemoteProvider({
        record: {
          ...record,
          transcriptionModel: undefined,
          transcriptionVariants: undefined,
          transcriptionAssist: undefined,
          transcriptionElapsedMs: undefined,
          remoteTranscription: undefined,
          transcript: [],
          summary: [],
          phase: "idle",
          progress: 0,
        },
        provider: "cloud",
        signal,
        store,
        save: async (next) => {
          observed = next;
          const members = new Set(next.transcript.map((row) => row.memberId));
          if (next.remoteTranscription?.parts.length && members.size >= 2) stop.abort();
          return next;
        },
        updateDiagnostic: async (next) => next,
      });
    } catch (error) {
      if (!stop.signal.aborted) throw error;
    }
    assert.equal(new Set(observed?.transcript.map((row) => row.memberId)).size, 2);
    assert.ok(
      observed!.transcript.every((row) => row.memberId && row.endMs - row.startMs <= 30000),
    );
    process.stdout.write(
      `${JSON.stringify({ source: "selected_recording_actual_member_tracks", totalMemberTracks: observed?.remoteTranscription?.sources?.length, savedParts: observed?.remoteTranscription?.parts.length, recognizedMembers: 2, utteranceRows: observed?.transcript.length, requests, maximumPhraseMs: Math.max(...observed!.transcript.map((row) => row.endMs - row.startMs)), originalRecordModified: false, elapsedMs: Date.now() - started })}\n`,
    );
  } else
    await transcribeRemoteParts(
      source.filePath,
      Math.min(30000, source.durationMs),
      signal,
      async (file, duration) => {
        const result = await store.transcribe(file, duration, "cloud", signal);
        process.stdout.write(
          `${JSON.stringify({ selectedRecording: id, source: "previously_failed_member_track", durationMs: duration, httpStatus, textLength: result.text.length, elapsedMs: Date.now() - started })}\n`,
        );
        return result;
      },
      async () => {},
      undefined,
      undefined,
      30000,
      true,
    );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ httpStatus, providerCode, errorCode: error instanceof Error && /^[a-z0-9_:-]+$/i.test(error.message) ? error.message : "probe_failed", elapsedMs: Date.now() - started })}\n`,
  );
  process.exitCode = 1;
} finally {
  plaintext = undefined;
  process.stdout.write(
    `${JSON.stringify({ credentialFileUnchanged: hash(encrypted) === hash(await readBoundedProviderFile(providerFile)), originalAudioModified: false })}\n`,
  );
  await rm(directory, { recursive: true, force: true });
}
