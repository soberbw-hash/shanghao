import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { VoiceReplayClip, VoiceReplayTranscript } from "@private-voice/shared";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const transcriptPattern = /^transcript-([0-9a-f-]{36})\.json$/;
const MAX_BYTES = 44 + 96_000 * 60 * 2;

function validStructuredTranscript(value: unknown, durationMs: number): boolean {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.sourceModel === "string" &&
    data.sourceModel.length > 0 &&
    data.sourceModel.length <= 100 &&
    Array.isArray(data.segments) &&
    data.segments.length <= 5000 &&
    data.segments.every((segment: unknown) => {
      if (!segment || typeof segment !== "object") return false;
      const s = segment as Record<string, unknown>;
      return (
        typeof s.text === "string" &&
        s.text.length > 0 &&
        s.text.length <= 20_000 &&
        typeof s.startMs === "number" &&
        Number.isFinite(s.startMs) &&
        s.startMs >= 0 &&
        typeof s.endMs === "number" &&
        Number.isFinite(s.endMs) &&
        s.endMs > s.startMs &&
        s.endMs <= durationMs &&
        (s.timestampPrecision === "aligned" || s.timestampPrecision === "chunk") &&
        (s.reviewStatus === undefined || s.reviewStatus === "edited")
      );
    })
  );
}

export function validateReplayWave(bytes: Uint8Array): { durationMs: number; sampleRate: number } {
  if (!(bytes instanceof Uint8Array) || bytes.length <= 44 || bytes.length > MAX_BYTES)
    throw Error("invalid_replay_audio");
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rate = data.readUInt32LE(24);
  if (
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 16) !== "WAVEfmt " ||
    data.readUInt32LE(4) !== data.length - 8 ||
    data.readUInt32LE(16) !== 16 ||
    data.readUInt16LE(20) !== 1 ||
    data.readUInt16LE(22) !== 1 ||
    data.readUInt16LE(34) !== 16 ||
    data.readUInt16LE(32) !== 2 ||
    data.readUInt32LE(28) !== rate * 2 ||
    data.toString("ascii", 36, 40) !== "data" ||
    data.readUInt32LE(40) !== data.length - 44 ||
    (data.length - 44) % 2 ||
    rate < 8000 ||
    rate > 96000 ||
    data.length - 44 > rate * 120
  )
    throw Error("invalid_replay_audio");
  return { durationMs: ((data.length - 44) * 500) / rate, sampleRate: rate };
}

function titleOf(input: string): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > 100 ||
    [...input].some((c) => c.charCodeAt(0) < 32)
  )
    throw Error("invalid_replay_title");
  return input.trim();
}

/** Each clip commits as one directory rename. Uncommitted staging is never listed or auto-deleted. */
export class VoiceReplayStore {
  private serial: Promise<unknown> = Promise.resolve();
  private readonly transcribing = new Set<string>();
  constructor(
    private readonly root: string,
    private readonly trash: (target: string) => Promise<void>,
  ) {}
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.serial.then(operation, operation);
    this.serial = task.catch(() => undefined);
    return task;
  }
  private async regular(target: string, directory = false): Promise<void> {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
      throw Error("unsafe_replay_path");
  }
  private async directory(id?: string): Promise<string> {
    await fs.mkdir(this.root, { recursive: true });
    await this.regular(this.root, true);
    if (id === undefined) return this.root;
    if (typeof id !== "string" || !idPattern.test(id)) throw Error("invalid_replay_id");
    const target = path.join(this.root, id);
    await this.regular(target, true);
    return target;
  }
  private async metadata(id: string): Promise<VoiceReplayClip> {
    const target = path.join(await this.directory(id), "clip.json");
    await this.regular(target);
    const stat = await fs.stat(target);
    if (stat.size > 2048) throw Error("invalid_replay_metadata");
    const data = JSON.parse(await fs.readFile(target, "utf8")) as VoiceReplayClip;
    if (
      data.id !== id ||
      titleOf(data.title) !== data.title ||
      !Number.isSafeInteger(data.createdAt) ||
      data.createdAt <= 0 ||
      !Number.isFinite(data.durationMs) ||
      data.durationMs <= 0 ||
      data.durationMs > 60000 ||
      !Number.isSafeInteger(data.byteLength) ||
      data.byteLength <= 44 ||
      data.byteLength > MAX_BYTES
    )
      throw Error("invalid_replay_metadata");
    return data;
  }
  private async listInternal(): Promise<VoiceReplayClip[]> {
    const names = await fs.readdir(await this.directory());
    const ids = names.filter((name) => idPattern.test(name));
    if (ids.length > 1000) throw Error("replay_library_full");
    const clips: VoiceReplayClip[] = [];
    for (const id of ids) clips.push(await this.metadata(id));
    return clips.sort((a, b) => b.createdAt - a.createdAt);
  }
  list(): Promise<VoiceReplayClip[]> {
    return this.run(() => this.listInternal());
  }

  private async saveInternal(
    title: string,
    bytes: Uint8Array,
    transcript?: Extract<VoiceReplayTranscript, { version: 2 }>,
  ): Promise<VoiceReplayClip> {
    title = titleOf(title);
    const { durationMs } = validateReplayWave(bytes);
    const encodedTranscript = transcript ? JSON.stringify(transcript) : undefined;
    if (
      transcript &&
      (!validStructuredTranscript(transcript, durationMs) ||
        transcript.text.length > 20_000 ||
        !Number.isSafeInteger(transcript.createdAt) ||
        transcript.createdAt <= 0 ||
        Buffer.byteLength(encodedTranscript!) > 100_000)
    )
      throw Error("invalid_replay_transcript");
    if ((await this.listInternal()).length >= 1000) throw Error("replay_library_full");
    const id = randomUUID();
    const clip: VoiceReplayClip = {
      id,
      title,
      durationMs,
      byteLength: bytes.length,
      createdAt: Date.now(),
    };
    const root = await this.directory();
    const staging = path.join(root, ".creating-" + id);
    await fs.mkdir(staging);
    await fs.writeFile(path.join(staging, "audio.wav"), bytes, { flag: "wx" });
    await fs.writeFile(path.join(staging, "clip.json"), JSON.stringify(clip), { flag: "wx" });
    if (encodedTranscript) {
      await fs.writeFile(path.join(staging, `transcript-${randomUUID()}.json`), encodedTranscript, {
        flag: "wx",
      });
    }
    await fs.rename(staging, path.join(root, id));
    return clip;
  }
  save(title: string, bytes: Uint8Array): Promise<VoiceReplayClip> {
    // Detach from the renderer's mutable buffer before waiting for the serialization queue.
    validateReplayWave(bytes);
    const copy = Uint8Array.from(bytes);
    return this.run(() => this.saveInternal(title, copy));
  }
  private async readInternal(id: string): Promise<Uint8Array> {
    const metadata = await this.metadata(id);
    const target = path.join(await this.directory(id), "audio.wav");
    await this.regular(target);
    if ((await fs.stat(target)).size !== metadata.byteLength) throw Error("invalid_replay_audio");
    const bytes = await fs.readFile(target);
    if (Math.abs(validateReplayWave(bytes).durationMs - metadata.durationMs) > 0.01)
      throw Error("invalid_replay_audio");
    return bytes;
  }
  read(id: string): Promise<Uint8Array> {
    return this.run(() => this.readInternal(id));
  }
  private async transcripts(
    id: string,
    durationMs: number,
  ): Promise<Array<{ value: VoiceReplayTranscript; name: string }>> {
    const directory = await this.directory(id);
    const names = (await fs.readdir(directory)).filter((name) => {
      const match = transcriptPattern.exec(name);
      return Boolean(match && idPattern.test(match[1]!));
    });
    if (names.length > 100) throw Error("voice_replay_transcript_limit");
    const results: Array<{ value: VoiceReplayTranscript; name: string }> = [];
    for (const name of names) {
      const target = path.join(directory, name);
      await this.regular(target);
      if ((await fs.stat(target)).size > 100_000) throw Error("invalid_replay_transcript");
      const data: unknown = JSON.parse(await fs.readFile(target, "utf8"));
      if (
        !data ||
        typeof data !== "object" ||
        !("version" in data) ||
        (data.version !== 1 && data.version !== 2) ||
        !("text" in data) ||
        typeof data.text !== "string" ||
        data.text.length > 20_000 ||
        !("createdAt" in data) ||
        !Number.isSafeInteger(data.createdAt) ||
        (data.createdAt as number) <= 0
      )
        throw Error("invalid_replay_transcript");
      if (data.version === 2) {
        if (!validStructuredTranscript(data, durationMs)) throw Error("invalid_replay_transcript");
      }
      results.push({ value: data as VoiceReplayTranscript, name });
    }
    return results.sort(
      (a, b) => b.value.createdAt - a.value.createdAt || b.name.localeCompare(a.name),
    );
  }
  readTranscript(id: string): Promise<string | undefined> {
    return this.readTranscriptDetail(id).then((value) => value?.text);
  }
  readTranscriptDetail(id: string): Promise<VoiceReplayTranscript | undefined> {
    return this.run(async () => {
      const clip = await this.metadata(id);
      return (await this.transcripts(id, clip.durationMs))[0]?.value;
    });
  }
  reviseTranscriptSegment(
    id: string,
    expectedCreatedAt: number,
    index: number,
    text: string,
  ): Promise<VoiceReplayTranscript> {
    return this.run(async () => {
      if (this.transcribing.has(id)) throw Error("voice_replay_transcription_busy");
      const clip = await this.metadata(id);
      const previous = await this.transcripts(id, clip.durationMs);
      if (previous.length >= 100) throw Error("voice_replay_transcript_limit");
      const current = previous[0]?.value;
      if (!current || current.version !== 2 || current.createdAt !== expectedCreatedAt)
        throw Error("voice_replay_transcript_changed");
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= current.segments.length ||
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 20_000 ||
        current.text !== current.segments.map((segment) => segment.text).join(" ")
      )
        throw Error("invalid_replay_transcript");
      const segments = current.segments.map((segment, i) =>
        i === index ? { ...segment, text: text.trim(), reviewStatus: "edited" as const } : segment,
      );
      const next = {
        ...current,
        createdAt: Math.max(Date.now(), current.createdAt + 1),
        text: segments.map((segment) => segment.text).join(" "),
        segments,
      };
      if (
        !Number.isSafeInteger(next.createdAt) ||
        next.text.length > 20_000 ||
        !validStructuredTranscript(next, clip.durationMs)
      )
        throw Error("invalid_replay_transcript");
      const encoded = JSON.stringify(next);
      if (Buffer.byteLength(encoded) > 100_000) throw Error("invalid_replay_transcript");
      const directory = await this.directory(id);
      const token = randomUUID();
      const temporary = path.join(directory, `.transcript-${token}.tmp`);
      await fs.writeFile(temporary, encoded, { flag: "wx" });
      await fs.rename(temporary, path.join(directory, `transcript-${token}.json`));
      return next;
    });
  }
  async transcribeLocal(
    id: string,
    run: (
      filePath: string,
      durationMs: number,
    ) => Promise<
      string | Omit<Extract<VoiceReplayTranscript, { version: 2 }>, "version" | "createdAt">
    >,
  ): Promise<string> {
    const input = await this.run(async () => {
      if (this.transcribing.has(id)) throw Error("voice_replay_transcription_busy");
      const bytes = await this.readInternal(id);
      const durationMs = validateReplayWave(bytes).durationMs;
      if ((await this.transcripts(id, durationMs)).length >= 100)
        throw Error("voice_replay_transcript_limit");
      const result = {
        filePath: path.join(await this.directory(id), "audio.wav"),
        durationMs,
      };
      this.transcribing.add(id);
      return result;
    });
    try {
      const result = await run(input.filePath, input.durationMs);
      const text = typeof result === "string" ? result : result.text;
      if (typeof text !== "string" || text.length > 20_000)
        throw Error("invalid_replay_transcript");
      if (typeof result !== "string" && !validStructuredTranscript(result, input.durationMs))
        throw Error("invalid_replay_transcript");
      await this.run(async () => {
        await this.metadata(id);
        const previous = await this.transcripts(id, input.durationMs);
        if (previous.length >= 100) throw Error("voice_replay_transcript_limit");
        const directory = await this.directory(id),
          token = randomUUID();
        const temporary = path.join(directory, `.transcript-${token}.tmp`);
        const createdAt = Math.max(Date.now(), (previous[0]?.value.createdAt ?? 0) + 1);
        if (!Number.isSafeInteger(createdAt)) throw Error("invalid_replay_transcript");
        const value =
          typeof result === "string"
            ? { version: 1, createdAt, text }
            : {
                version: 2,
                createdAt,
                text,
                sourceModel: result.sourceModel,
                segments: result.segments.map(({ text, startMs, endMs, timestampPrecision }) => ({
                  text,
                  startMs,
                  endMs,
                  timestampPrecision,
                })),
              };
        const encoded = JSON.stringify(value);
        if (Buffer.byteLength(encoded) > 100_000) throw Error("invalid_replay_transcript");
        await fs.writeFile(temporary, encoded, {
          flag: "wx",
        });
        await fs.rename(temporary, path.join(directory, `transcript-${token}.json`));
      });
      return text;
    } finally {
      this.transcribing.delete(id);
    }
  }
  rename(id: string, title: string): Promise<void> {
    return this.run(async () => {
      const clip = await this.metadata(id);
      clip.title = titleOf(title);
      const directory = await this.directory(id);
      const staging = path.join(directory, randomUUID() + ".tmp");
      await fs.writeFile(staging, JSON.stringify(clip), { flag: "wx" });
      await fs.rename(staging, path.join(directory, "clip.json"));
    });
  }
  trim(id: string, fromMs: number, toMs: number): Promise<VoiceReplayClip> {
    return this.run(async () => {
      const clip = await this.metadata(id);
      const original = await this.readInternal(id);
      const { sampleRate } = validateReplayWave(original);
      if (
        !Number.isFinite(fromMs) ||
        !Number.isFinite(toMs) ||
        fromMs < 0 ||
        toMs <= fromMs ||
        toMs > clip.durationMs
      )
        throw Error("invalid_replay_trim");
      const start = Math.floor((fromMs * sampleRate) / 1000) * 2;
      const end = Math.min(original.length - 44, Math.floor((toMs * sampleRate) / 1000) * 2);
      const bytes = Buffer.alloc(44 + end - start);
      bytes.set(original.subarray(0, 44));
      bytes.set(original.subarray(44 + start, 44 + end), 44);
      bytes.writeUInt32LE(bytes.length - 8, 4);
      bytes.writeUInt32LE(bytes.length - 44, 40);
      const current = (await this.transcripts(id, clip.durationMs))[0]?.value;
      const actualStartMs = (start / 2 / sampleRate) * 1000;
      const actualEndMs = (end / 2 / sampleRate) * 1000;
      const trimmedDurationMs = ((end - start) / 2 / sampleRate) * 1000;
      const segments =
        current?.version === 2
          ? current.segments
              .filter((segment) => segment.startMs >= actualStartMs && segment.endMs <= actualEndMs)
              .map((segment) => {
                // Sample-derived boundaries can differ from aligned timestamps by a few ULPs.
                // Clamp rebased times to the exact duration of the generated WAV.
                const rebasedStartMs = segment.startMs - actualStartMs;
                const rebasedEndMs = segment.endMs - actualStartMs;
                const startMs = Math.abs(rebasedStartMs) < 1e-6 ? 0 : Math.max(0, rebasedStartMs);
                const endMs =
                  Math.abs(trimmedDurationMs - rebasedEndMs) < 1e-6
                    ? trimmedDurationMs
                    : Math.min(trimmedDurationMs, rebasedEndMs);
                return { ...segment, startMs, endMs };
              })
              .filter((segment) => segment.endMs > segment.startMs)
          : [];
      const transcript =
        current?.version === 2 && segments.length
          ? {
              version: 2 as const,
              createdAt: Date.now(),
              sourceModel: current.sourceModel,
              derivedFromTrim: true as const,
              text: segments.map((segment) => segment.text).join(" "),
              segments,
            }
          : undefined;
      return this.saveInternal(clip.title.slice(0, 94) + " · 裁剪", bytes, transcript);
    });
  }
  remove(id: string): Promise<void> {
    return this.run(async () => {
      if (this.transcribing.has(id)) throw Error("voice_replay_transcription_busy");
      await this.metadata(id);
      await this.trash(await this.directory(id));
    });
  }
}
