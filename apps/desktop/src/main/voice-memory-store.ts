import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  evaluateVoiceMemoryTranscriptionValidity,
  hasInvalidVoiceMemoryResult,
  mergeTranscriptIntoSentences,
  type VoiceMemoryRecord,
  type VoiceMemorySummary,
  type VoiceMemoryTranscriptionUnit,
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
const SUMMARY_FILE = "summaries.json";
const PENDING_METADATA_FILE = "pending-metadata.json";
const RECORD_DIRECTORY = "records";
const TRANSCRIPTION_EVENT_DIRECTORY = "transcription-events";

interface PersistedVoiceMemorySummaries {
  schemaVersion: 1;
  entries: VoiceMemorySummary[];
}

const normalize = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();

const safeRecordingId = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("invalid_recording_id");
  if (/^[a-zA-Z0-9._-]{1,180}$/.test(trimmed)) return trimmed;
  return createHash("sha256").update(trimmed).digest("hex");
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isIndexEntry = (value: unknown): value is IndexedVoiceMemoryEntry =>
  isObject(value) &&
  typeof value.recordingId === "string" &&
  typeof value.filePath === "string" &&
  typeof value.createdAt === "string" &&
  isFiniteNumber(value.startMs) &&
  (typeof value.title === "string" || (value.kind === "transcript" && value.title === undefined)) &&
  typeof value.excerpt === "string" &&
  typeof value.normalizedText === "string" &&
  ["transcript", "chapter", "highlight", "marker"].includes(String(value.kind));

const isSummaryEntry = (value: unknown): value is VoiceMemorySummary =>
  isObject(value) &&
  typeof value.recordingId === "string" &&
  typeof value.filePath === "string" &&
  typeof value.createdAt === "string" &&
  typeof value.updatedAt === "string" &&
  isFiniteNumber(value.transcriptCount) &&
  isFiniteNumber(value.speakerCount) &&
  isFiniteNumber(value.chapterCount) &&
  isFiniteNumber(value.highlightCount) &&
  isFiniteNumber(value.markerCount);

const isLegacySummaryEntry = (value: unknown): value is { recordingId: string; title: string } =>
  isObject(value) &&
  typeof value.recordingId === "string" &&
  value.recordingId.length > 0 &&
  typeof value.title === "string";

const isTranscriptSegment = (value: unknown): boolean =>
  isObject(value) &&
  typeof value.text === "string" &&
  isFiniteNumber(value.startMs) &&
  isFiniteNumber(value.endMs) &&
  (value.words === undefined ||
    (Array.isArray(value.words) &&
      value.words.every(
        (word) =>
          isObject(word) &&
          typeof word.text === "string" &&
          isFiniteNumber(word.startMs) &&
          isFiniteNumber(word.endMs),
      )));

const hasIndexableEntries = (value: unknown, timeField: "startMs" | "offsetMs"): boolean =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (entry) =>
        isObject(entry) && isFiniteNumber(entry[timeField]) && typeof entry.title === "string",
    ));

const isVoiceMemoryRecord = (value: unknown): value is VoiceMemoryRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<VoiceMemoryRecord>;
  const compatibleVersion = record.schemaVersion === undefined || record.schemaVersion === 1;
  const legacyRecord = record.schemaVersion === undefined;
  return (
    compatibleVersion &&
    typeof record.recordingId === "string" &&
    typeof record.filePath === "string" &&
    Array.isArray(record.transcript) &&
    record.transcript.every(isTranscriptSegment) &&
    hasIndexableEntries(record.chapters, "startMs") &&
    hasIndexableEntries(record.highlights, "startMs") &&
    hasIndexableEntries(record.markerTitles, "offsetMs") &&
    (record.highlights === undefined ||
      record.highlights.every(
        (highlight: unknown) => isObject(highlight) && typeof highlight.description === "string",
      )) &&
    (record.phase === undefined ||
      ["idle", "transcribing", "organizing", "ready", "paused", "error"].includes(record.phase)) &&
    (legacyRecord ||
      (typeof record.createdAt === "string" &&
        typeof record.updatedAt === "string" &&
        ["idle", "transcribing", "organizing", "ready", "paused", "error"].includes(
          String(record.phase),
        ) &&
        isFiniteNumber(record.progress) &&
        Array.isArray(record.speakers) &&
        Array.isArray(record.summary) &&
        Array.isArray(record.chapters) &&
        Array.isArray(record.highlights) &&
        Array.isArray(record.markerTitles) &&
        Array.isArray(record.timeline)))
  );
};

const normalizeLegacyRecord = (record: VoiceMemoryRecord): VoiceMemoryRecord => {
  if (record.schemaVersion === 1) return record;
  const createdAt =
    typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString();
  const phase = record.phase ?? (record.transcript.length ? "ready" : "idle");
  return {
    ...record,
    schemaVersion: 1,
    createdAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
    phase,
    progress: Number.isFinite(record.progress) ? record.progress : phase === "ready" ? 100 : 0,
    speakers: Array.isArray(record.speakers) ? record.speakers : [],
    summary: Array.isArray(record.summary) ? record.summary : [],
    chapters: Array.isArray(record.chapters) ? record.chapters : [],
    highlights: Array.isArray(record.highlights) ? record.highlights : [],
    markerTitles: Array.isArray(record.markerTitles) ? record.markerTitles : [],
    timeline: Array.isArray(record.timeline) ? record.timeline : [],
  };
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
  private summaries: PersistedVoiceMemorySummaries = { schemaVersion: 1, entries: [] };
  private mutationQueue: Promise<void> = Promise.resolve();
  private metadataRecoveryRequired = false;

  constructor(private readonly rootDirectory: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.recordsDirectory(), { recursive: true });
    const pendingMetadata = await this.readOptionalJson<unknown>(this.pendingMetadataPath());
    if (pendingMetadata !== undefined) {
      if (!isObject(pendingMetadata) || pendingMetadata.schemaVersion !== 1) {
        throw new Error("voice_memory_metadata_recovery_unreadable");
      }
      // A prior write may have stopped after committing a record but before its
      // derived files. Rebuild only after every source record has been read.
      const records = await this.list();
      const recoveredIndex: PersistedVoiceMemoryIndex = {
        schemaVersion: 1,
        entries: records.flatMap(indexEntriesFor),
      };
      const recoveredSummaries: PersistedVoiceMemorySummaries = {
        schemaVersion: 1,
        entries: records
          .map(toVoiceMemorySummary)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      };
      await atomicWrite(this.indexPath(), JSON.stringify(recoveredIndex));
      await atomicWrite(this.summaryPath(), JSON.stringify(recoveredSummaries));
      await rm(this.pendingMetadataPath());
      this.index = recoveredIndex;
      this.summaries = recoveredSummaries;
      this.metadataRecoveryRequired = false;
      return;
    }
    const index = await this.readOptionalJson<PersistedVoiceMemoryIndex>(this.indexPath());
    const summaries = await this.readOptionalJson<{ schemaVersion: unknown; entries: unknown[] }>(
      this.summaryPath(),
    );
    if (
      index !== undefined &&
      (!index ||
        index.schemaVersion !== 1 ||
        !Array.isArray(index.entries) ||
        !index.entries.every(isIndexEntry))
    ) {
      throw new Error("voice_memory_index_unreadable");
    }
    if (
      summaries !== undefined &&
      (!summaries ||
        summaries.schemaVersion !== 1 ||
        !Array.isArray(summaries.entries) ||
        !summaries.entries.every((entry) => isSummaryEntry(entry) || isLegacySummaryEntry(entry)))
    ) {
      throw new Error("voice_memory_summaries_unreadable");
    }
    this.index = index
      ? {
          schemaVersion: 1,
          entries: index.entries.map((entry) => ({
            ...entry,
            title: entry.title ?? "语音",
          })),
        }
      : { schemaVersion: 1, entries: [] };
    if (summaries) {
      const recordsById = new Map(
        (summaries.entries.some(isLegacySummaryEntry) ? await this.list() : []).map((record) => [
          record.recordingId,
          record,
        ]),
      );
      this.summaries = {
        schemaVersion: 1,
        entries: summaries.entries.map((entry) => {
          if (isSummaryEntry(entry)) return entry;
          if (!isLegacySummaryEntry(entry)) throw new Error("voice_memory_summaries_unreadable");
          const record = recordsById.get(entry.recordingId);
          if (!record) throw new Error("voice_memory_summaries_unreadable");
          return toVoiceMemorySummary(record);
        }),
      };
    } else {
      this.summaries = summaries ?? { schemaVersion: 1, entries: [] };
    }
    if (!this.index.entries.length || !this.summaries.entries.length) {
      const records = await this.list();
      if (!this.index.entries.length && records.length) {
        const rebuiltIndex: PersistedVoiceMemoryIndex = {
          schemaVersion: 1,
          entries: records.flatMap(indexEntriesFor),
        };
        if (index === undefined) {
          await atomicWrite(this.indexPath(), JSON.stringify(rebuiltIndex));
        }
        this.index = rebuiltIndex;
      }
      if (!this.summaries.entries.length && records.length) {
        const rebuiltSummaries: PersistedVoiceMemorySummaries = {
          schemaVersion: 1,
          entries: records
            .map(toVoiceMemorySummary)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
        };
        await atomicWrite(this.summaryPath(), JSON.stringify(rebuiltSummaries));
        this.summaries = rebuiltSummaries;
      }
    }
  }

  recordingIdFor(filePath: string): string {
    return createHash("sha256")
      .update(path.resolve(filePath).toLocaleLowerCase("en-US"))
      .digest("hex");
  }

  private transcriptionEventsPath(recordingId: string): string {
    return path.join(
      this.rootDirectory,
      TRANSCRIPTION_EVENT_DIRECTORY,
      `${safeRecordingId(recordingId)}.ndjson`,
    );
  }

  async get(recordingId: string): Promise<VoiceMemoryRecord | undefined> {
    const record = await this.readOptionalJson<VoiceMemoryRecord>(this.recordPath(recordingId));
    if (record !== undefined && !isVoiceMemoryRecord(record)) {
      throw new Error("voice_memory_record_unreadable");
    }
    return record ? normalizeLegacyRecord(record) : undefined;
  }

  async save(
    record: VoiceMemoryRecord,
    options: { clearTranscriptionEvents?: boolean } = {},
  ): Promise<VoiceMemoryRecord> {
    return this.mutate(async () => {
      if (!isVoiceMemoryRecord(record)) {
        throw new Error("voice_memory_record_unreadable");
      }
      await this.get(record.recordingId);
      const next = normalizeLegacyRecord({ ...record, updatedAt: new Date().toISOString() });
      if (!isVoiceMemoryRecord(next)) {
        throw new Error("voice_memory_record_unreadable");
      }
      const summary = toVoiceMemorySummary(next);
      const indexEntries = indexEntriesFor(next);
      const nextSummaries: PersistedVoiceMemorySummaries = {
        schemaVersion: 1,
        entries: [
          summary,
          ...this.summaries.entries.filter((entry) => entry.recordingId !== next.recordingId),
        ],
      };
      const nextIndex: PersistedVoiceMemoryIndex = {
        schemaVersion: 1,
        entries: [
          ...this.index.entries.filter((entry) => entry.recordingId !== next.recordingId),
          ...indexEntries,
        ],
      };
      await this.beginMetadataMutation();
      try {
        await atomicWrite(this.recordPath(record.recordingId), JSON.stringify(next, null, 2));
        if (options.clearTranscriptionEvents) {
          await rm(this.transcriptionEventsPath(record.recordingId), { force: true });
        }
        await atomicWrite(this.summaryPath(), JSON.stringify(nextSummaries));
        await atomicWrite(this.indexPath(), JSON.stringify(nextIndex));
        await rm(this.pendingMetadataPath());
        this.summaries = nextSummaries;
        this.index = nextIndex;
      } catch (error) {
        this.metadataRecoveryRequired = true;
        throw error;
      }
      return next;
    });
  }

  /** Appends a compact per-unit checkpoint for crash recovery and auditability. */
  async appendTranscriptionUnit(
    recordingId: string,
    unit: VoiceMemoryTranscriptionUnit,
  ): Promise<void> {
    await this.mutate(async () => {
      const directory = path.join(this.rootDirectory, TRANSCRIPTION_EVENT_DIRECTORY);
      await mkdir(directory, { recursive: true });
      const compactUnit = Object.fromEntries(
        Object.entries(unit).filter(([key]) => key !== "rawRuntimeOutput"),
      );
      await appendFile(
        this.transcriptionEventsPath(recordingId),
        `${JSON.stringify({ recordedAt: new Date().toISOString(), unit: compactUnit })}\n`,
        "utf8",
      );
    });
  }

  async delete(recordingId: string): Promise<void> {
    await this.mutate(async () => {
      const nextIndex: PersistedVoiceMemoryIndex = {
        schemaVersion: 1,
        entries: this.index.entries.filter((entry) => entry.recordingId !== recordingId),
      };
      const nextSummaries: PersistedVoiceMemorySummaries = {
        schemaVersion: 1,
        entries: this.summaries.entries.filter((entry) => entry.recordingId !== recordingId),
      };
      await this.beginMetadataMutation();
      try {
        await rm(this.recordPath(recordingId), { force: true });
        await rm(this.transcriptionEventsPath(recordingId), { force: true });
        await atomicWrite(this.indexPath(), JSON.stringify(nextIndex));
        await atomicWrite(this.summaryPath(), JSON.stringify(nextSummaries));
        await rm(this.pendingMetadataPath());
        this.index = nextIndex;
        this.summaries = nextSummaries;
      } catch (error) {
        this.metadataRecoveryRequired = true;
        throw error;
      }
    });
  }

  async list(): Promise<VoiceMemoryRecord[]> {
    const files = (await readdir(this.recordsDirectory())).filter((file) => file.endsWith(".json"));
    const records: VoiceMemoryRecord[] = [];
    // Keep disk reads bounded when a user has accumulated many long recordings.
    for (let offset = 0; offset < files.length; offset += 8) {
      const batch = await Promise.all(
        files.slice(offset, offset + 8).map(async (file) => {
          const record = await this.readOptionalJson<VoiceMemoryRecord>(
            path.join(this.recordsDirectory(), file),
          );
          if (record !== undefined && !isVoiceMemoryRecord(record)) {
            throw new Error("voice_memory_record_unreadable");
          }
          return record ? normalizeLegacyRecord(record) : undefined;
        }),
      );
      records.push(...batch.filter((record): record is VoiceMemoryRecord => Boolean(record)));
    }
    return records;
  }

  async listSummaries(
    options: { limit?: number; offset?: number } = {},
  ): Promise<VoiceMemorySummary[]> {
    this.assertMetadataReady();
    const limit = Math.max(1, Math.min(200, options.limit ?? 100));
    const offset = Math.max(0, options.offset ?? 0);
    return this.summaries.entries.slice(offset, offset + limit).map((entry) => ({ ...entry }));
  }

  search(request: VoiceMemorySearchRequest): VoiceMemorySearchResult[] {
    this.assertMetadataReady();
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
    this.assertMetadataReady();
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

  private async beginMetadataMutation(): Promise<void> {
    await atomicWrite(this.pendingMetadataPath(), JSON.stringify({ schemaVersion: 1 }));
  }

  private assertMetadataReady(): void {
    if (this.metadataRecoveryRequired) throw new Error("voice_memory_metadata_recovery_required");
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

  private summaryPath(): string {
    return path.join(this.rootDirectory, SUMMARY_FILE);
  }

  private pendingMetadataPath(): string {
    return path.join(this.rootDirectory, PENDING_METADATA_FILE);
  }

  private async readJson<T>(filePath: string): Promise<T> {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  }

  private async readOptionalJson<T>(filePath: string): Promise<T | undefined> {
    try {
      return await this.readJson<T>(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("voice_memory_unreadable", { cause: error });
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue
      .catch(() => undefined)
      .then(() => {
        if (this.metadataRecoveryRequired)
          throw new Error("voice_memory_metadata_recovery_required");
        return operation();
      });
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const indexEntriesFor = (record: VoiceMemoryRecord): IndexedVoiceMemoryEntry[] => {
  const base = {
    recordingId: record.recordingId,
    filePath: record.filePath,
    roomName: record.roomName,
    roomId: record.roomId,
    createdAt: record.createdAt,
    score: 0,
  };
  const readableTranscript = mergeTranscriptIntoSentences(record.transcript);
  return [
    ...readableTranscript.map((segment) => ({
      ...base,
      startMs: segment.startMs,
      title: segment.nickname ?? segment.speakerId ?? "语音",
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
};

const toVoiceMemorySummary = (record: VoiceMemoryRecord): VoiceMemorySummary => {
  const validity = evaluateVoiceMemoryTranscriptionValidity(
    record.transcriptionStats,
    record.transcriptionUnits,
  );
  return {
    recordingId: record.recordingId,
    filePath: record.filePath,
    roomId: record.roomId,
    roomName: record.roomName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    phase: record.phase,
    progress: record.progress,
    taskStatus: record.taskStatus,
    processingStage: record.processingStage,
    errorMessage: record.errorMessage,
    transcriptionModel: record.transcriptionModel,
    transcriptCount: record.transcript.length,
    speakerCount: record.speakers.length,
    chapterCount: record.chapters.length,
    highlightCount: record.highlights.length,
    markerCount: record.markerTitles.length,
    transcriptionComplete:
      validity.complete ||
      (record.transcriptionStats === undefined &&
        record.phase === "ready" &&
        record.transcript.length > 0 &&
        !hasInvalidVoiceMemoryResult(record)),
    invalidResult: hasInvalidVoiceMemoryResult(record),
  };
};
