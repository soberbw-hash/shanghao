import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  mergeTranscriptIntoSentences,
  type VoiceMemoryRecord,
  type VoiceMemorySearchRequest,
  type VoiceMemorySearchResult,
} from "@private-voice/shared";

interface IndexedVoiceMemoryEntry extends VoiceMemorySearchResult {
  normalizedText: string;
  nickname?: string;
  roomId?: string;
}

interface PersistedVoiceMemoryIndex {
  schemaVersion: 1;
  entries: IndexedVoiceMemoryEntry[];
}

const INDEX_FILE = "index.json";
const RECORD_DIRECTORY = "records";

const normalize = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();

const safeRecordingId = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("invalid_recording_id");
  if (/^[a-zA-Z0-9._-]{1,180}$/.test(trimmed)) return trimmed;
  return createHash("sha256").update(trimmed).digest("hex");
};

const atomicWrite = async (filePath: string, content: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, filePath);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
      await delay(30 * 2 ** attempt);
    }
  }
};

const scoreEntry = (entry: IndexedVoiceMemoryEntry, terms: string[]): number => {
  let score = 0;
  for (const term of terms) {
    if (!entry.normalizedText.includes(term)) continue;
    score += entry.title.toLocaleLowerCase("zh-CN").includes(term) ? 8 : 3;
    if (entry.nickname?.toLocaleLowerCase("zh-CN").includes(term)) score += 4;
  }
  return score;
};

/** Stores one durable JSON document per recording and a compact searchable index. */
export class VoiceMemoryStore {
  private index: PersistedVoiceMemoryIndex = { schemaVersion: 1, entries: [] };
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly rootDirectory: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.recordsDirectory(), { recursive: true });
    this.index = await this.readJson<PersistedVoiceMemoryIndex>(this.indexPath()).catch(() => ({
      schemaVersion: 1,
      entries: [],
    }));
  }

  recordingIdFor(filePath: string): string {
    return createHash("sha256")
      .update(path.resolve(filePath).toLocaleLowerCase("en-US"))
      .digest("hex");
  }

  async get(recordingId: string): Promise<VoiceMemoryRecord | undefined> {
    return this.readJson<VoiceMemoryRecord>(this.recordPath(recordingId)).catch(() => undefined);
  }

  async save(record: VoiceMemoryRecord): Promise<VoiceMemoryRecord> {
    return this.mutate(async () => {
      const next = { ...record, updatedAt: new Date().toISOString() };
      await atomicWrite(this.recordPath(record.recordingId), JSON.stringify(next, null, 2));
      await this.reindex(next);
      return next;
    });
  }

  async delete(recordingId: string): Promise<void> {
    await this.mutate(async () => {
      await rm(this.recordPath(recordingId), { force: true });
      this.index = {
        schemaVersion: 1,
        entries: this.index.entries.filter((entry) => entry.recordingId !== recordingId),
      };
      await atomicWrite(this.indexPath(), JSON.stringify(this.index));
    });
  }

  async list(): Promise<VoiceMemoryRecord[]> {
    const files = await readdir(this.recordsDirectory()).catch(() => []);
    const records = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) =>
          this.readJson<VoiceMemoryRecord>(path.join(this.recordsDirectory(), file)).catch(
            () => undefined,
          ),
        ),
    );
    return records.filter((record): record is VoiceMemoryRecord => Boolean(record));
  }

  search(request: VoiceMemorySearchRequest): VoiceMemorySearchResult[] {
    const terms = normalize(request.query).split(" ").filter(Boolean);
    if (!terms.length) return [];
    const nickname = request.nickname ? normalize(request.nickname) : undefined;
    return this.index.entries
      .filter((entry) => {
        if (nickname && normalize(entry.nickname ?? "") !== nickname) return false;
        if (request.roomId && entry.roomId !== request.roomId) return false;
        if (request.dateFrom && entry.createdAt < request.dateFrom) return false;
        if (request.dateTo && entry.createdAt > `${request.dateTo}T23:59:59.999Z`) return false;
        return terms.every((term) => entry.normalizedText.includes(term));
      })
      .map((entry) => ({ ...entry, score: scoreEntry(entry, terms) }))
      .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Math.min(100, request.limit ?? 30)))
      .map(
        ({ normalizedText: _normalizedText, nickname: _nickname, roomId: _roomId, ...entry }) =>
          entry,
      );
  }

  related(query: string, limit = 24): VoiceMemorySearchResult[] {
    const normalizedQuery = normalize(query);
    const wordTerms = normalizedQuery.split(" ").filter((term) => term.length > 1);
    const chineseChunks = normalizedQuery.match(/[\p{Script=Han}]{2,}/gu) ?? [];
    const bigrams = chineseChunks.flatMap((chunk) =>
      Array.from({ length: Math.max(0, chunk.length - 1) }, (_, index) =>
        chunk.slice(index, index + 2),
      ),
    );
    const terms = [...new Set([...wordTerms, ...bigrams])].slice(0, 32);
    if (!terms.length) return [];
    return this.index.entries
      .map((entry) => ({
        entry,
        score: terms.reduce(
          (score, term) => score + (entry.normalizedText.includes(term) ? 1 : 0),
          0,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt))
      .slice(0, Math.max(1, Math.min(60, limit)))
      .map(({ entry, score }) => {
        return {
          recordingId: entry.recordingId,
          filePath: entry.filePath,
          roomName: entry.roomName,
          createdAt: entry.createdAt,
          startMs: entry.startMs,
          title: entry.title,
          excerpt: entry.excerpt,
          kind: entry.kind,
          score,
        };
      });
  }

  private async reindex(record: VoiceMemoryRecord): Promise<void> {
    const retained = this.index.entries.filter((entry) => entry.recordingId !== record.recordingId);
    const base = {
      recordingId: record.recordingId,
      filePath: record.filePath,
      roomName: record.roomName,
      roomId: record.roomId,
      createdAt: record.createdAt,
      score: 0,
    };
    const readableTranscript = mergeTranscriptIntoSentences(record.transcript);
    const entries: IndexedVoiceMemoryEntry[] = [
      ...readableTranscript.map((segment) => ({
        ...base,
        startMs: segment.startMs,
        title: segment.nickname ?? segment.speakerId,
        excerpt: segment.text,
        nickname: segment.nickname,
        kind: "transcript" as const,
        normalizedText: normalize(
          [segment.text, segment.nickname, segment.speakerId, record.roomName]
            .filter(Boolean)
            .join(" "),
        ),
      })),
      ...record.chapters.map((chapter) => ({
        ...base,
        startMs: chapter.startMs,
        title: chapter.title,
        excerpt: chapter.description ?? chapter.title,
        kind: "chapter" as const,
        normalizedText: normalize(
          `${chapter.title} ${chapter.description ?? ""} ${record.roomName ?? ""}`,
        ),
      })),
      ...record.highlights.map((highlight) => ({
        ...base,
        startMs: highlight.startMs,
        title: highlight.title,
        excerpt: highlight.description,
        kind: "highlight" as const,
        normalizedText: normalize(
          `${highlight.title} ${highlight.description} ${record.roomName ?? ""}`,
        ),
      })),
      ...record.markerTitles.map((marker) => ({
        ...base,
        startMs: marker.offsetMs,
        title: marker.title,
        excerpt: marker.title,
        kind: "marker" as const,
        normalizedText: normalize(`${marker.title} ${record.roomName ?? ""}`),
      })),
    ];
    this.index = { schemaVersion: 1, entries: [...retained, ...entries] };
    await atomicWrite(this.indexPath(), JSON.stringify(this.index));
  }

  private recordsDirectory(): string {
    return path.join(this.rootDirectory, RECORD_DIRECTORY);
  }

  private recordPath(recordingId: string): string {
    return path.join(this.recordsDirectory(), `${safeRecordingId(recordingId)}.json`);
  }

  private indexPath(): string {
    return path.join(this.rootDirectory, INDEX_FILE);
  }

  private async readJson<T>(filePath: string): Promise<T> {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.catch(() => undefined).then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
