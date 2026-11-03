import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { VoiceReplayClip } from "@private-voice/shared";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const transcriptPattern = /^transcript-([0-9a-f-]{36})\.json$/;
const MAX_BYTES = 44 + 96_000 * 60 * 2;

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

  private async saveInternal(title: string, bytes: Uint8Array): Promise<VoiceReplayClip> {
    title = titleOf(title);
    const { durationMs } = validateReplayWave(bytes);
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
  ): Promise<Array<{ text: string; createdAt: number; name: string }>> {
    const directory = await this.directory(id);
    const names = (await fs.readdir(directory)).filter((name) => {
      const match = transcriptPattern.exec(name);
      return Boolean(match && idPattern.test(match[1]!));
    });
    if (names.length > 100) throw Error("voice_replay_transcript_limit");
    const results: Array<{ text: string; createdAt: number; name: string }> = [];
    for (const name of names) {
      const target = path.join(directory, name);
      await this.regular(target);
      if ((await fs.stat(target)).size > 100_000) throw Error("invalid_replay_transcript");
      const data: unknown = JSON.parse(await fs.readFile(target, "utf8"));
      if (
        !data ||
        typeof data !== "object" ||
        !("version" in data) ||
        data.version !== 1 ||
        !("text" in data) ||
        typeof data.text !== "string" ||
        data.text.length > 20_000 ||
        !("createdAt" in data) ||
        !Number.isSafeInteger(data.createdAt) ||
        (data.createdAt as number) <= 0
      )
        throw Error("invalid_replay_transcript");
      results.push({ text: data.text, createdAt: data.createdAt as number, name });
    }
    return results.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
  }
  readTranscript(id: string): Promise<string | undefined> {
    return this.run(async () => {
      await this.metadata(id);
      return (await this.transcripts(id))[0]?.text;
    });
  }
  async transcribeLocal(
    id: string,
    run: (filePath: string, durationMs: number) => Promise<string>,
  ): Promise<string> {
    const input = await this.run(async () => {
      if (this.transcribing.has(id)) throw Error("voice_replay_transcription_busy");
      const bytes = await this.readInternal(id);
      if ((await this.transcripts(id)).length >= 100) throw Error("voice_replay_transcript_limit");
      const result = {
        filePath: path.join(await this.directory(id), "audio.wav"),
        durationMs: validateReplayWave(bytes).durationMs,
      };
      this.transcribing.add(id);
      return result;
    });
    try {
      const text = await run(input.filePath, input.durationMs);
      if (typeof text !== "string" || text.length > 20_000)
        throw Error("invalid_replay_transcript");
      await this.run(async () => {
        await this.metadata(id);
        if ((await this.transcripts(id)).length >= 100)
          throw Error("voice_replay_transcript_limit");
        const directory = await this.directory(id),
          token = randomUUID();
        const temporary = path.join(directory, `.transcript-${token}.tmp`);
        await fs.writeFile(temporary, JSON.stringify({ version: 1, createdAt: Date.now(), text }), {
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
      return this.saveInternal(clip.title.slice(0, 94) + " · 裁剪", bytes);
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
